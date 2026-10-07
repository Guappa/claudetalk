import { Client, Events, GatewayIntentBits, Options } from "discord.js";
import { loadConfig } from "./config.ts";
import { acquireInstanceLock, lockPathBeside, STALE_AFTER_MS } from "./instanceLock.ts";
import { RESTART_EXIT_CODE, takeStopRequest, watchForStop, whenIdle, type StopMode, type StopRequest } from "./stopSignal.ts";
import { CHECK_FLAG } from "./bootCheck.ts";
import { askerFor } from "./discord/restart.ts";
import { createBridge } from "./bridge.ts";
import { sweepAttachments } from "./attachments.ts";
import { handleMessage } from "./discord/handlers/message.ts";
import { handleInteraction } from "./discord/handlers/interaction.ts";
import { onServerJoined, startUp } from "./discord/startup.ts";
import { NO_MENTIONS } from "./discord/sink.ts";
import { describeClaudeVersions } from "./claude/versions.ts";
import { count } from "./text.ts";

const config = loadConfig();
// The wrappers and the service definitions say so: only then is leaving to be started again more than leaving.
const supervised = process.argv.includes("--supervised");
// A restart asks this of the code on disk first: everything a start loads and reads, short of taking the lock and logging in.
if (process.argv.includes(CHECK_FLAG)) {
  await createBridge(config, supervised);
  console.log("The bridge would start.");
  process.exit(0);
}
const lockPath = lockPathBeside(config.bindingsPath);
const lock = await acquireInstanceLock(lockPath, undefined, supervised);
// A request left over from a previous run would stop this one on its first tick; cleared only once the lock is ours, or a start that is refused would eat the running bridge's.
await takeStopRequest(lockPath);

console.log(`Owners: ${config.ownerIds.join(", ")}.`);

const bridge = await createBridge(config, supervised);
console.log(
  `Language: ${bridge.language.current()} (${bridge.language.wasPicked() ? "picked with /language" : "host default"}).`,
);
console.log(describeClaudeVersions(bridge.claude));
bridge.updates.watch();
await sweepAttachments();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  // Text the bridge posts can quote a transcript, and a mention quoted there must not ping; a message meant to reach someone names them itself.
  allowedMentions: { ...NO_MENTIONS, repliedUser: false },
  // Nothing here reads a cached message: /purge and /ask fetch, and a reply is fetched by id.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    ReactionManager: 0,
    GuildScheduledEventManager: 0,
    StageInstanceManager: 0,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 600, lifetime: 900 },
  },
});

// A drain lets running turns finish; only "now" cuts them short, and asking to drain twice changes nothing.
function shutdownOnce(): (mode: StopMode) => Promise<void> {
  let started = false;
  let restarting = false;
  return async (mode) => {
    if (mode === "now") bridge.flow.stopAll();
    // The last word decides how it ends: a stop asked for after a restart is a stop.
    restarting = mode === "restart";
    if (started) return;
    started = true;
    const turns = bridge.flow.activeCount();
    if (turns > 0) console.log(`stopping after ${count(turns, "running turn")}`);
    await bridge.flow.drain((left) => void lock.noteDraining(left).catch(() => undefined));
    clearInterval(stopWatch);
    console.log(restarting ? "stopped, to be started again" : "stopped");
    if (!restarting) await bridge.restartNote.clear();
    await client.destroy();
    await lock.release();
    process.exit(restarting ? RESTART_EXIT_CODE : 0);
  };
}

const shutDown = shutdownOnce();
// Two bridges answer every message twice, so the one that finds its lock taken is the one that goes.
lock.whenTaken((holder) => {
  console.error(
    `Another bridge holds the lock now (pid ${holder.pid}, started ${holder.startedAt}). ` +
      `This one did not refresh its lock for over ${STALE_AFTER_MS / 1000} seconds, usually because the machine slept or the process was suspended, and the other was started in that time. ` +
      `Stopping this one so that no message is answered twice; the other carries on, and \`npm run stop\` stops it.`,
  );
  void shutDown("now");
});
// A restart waits for the bridge to be idle and goes on serving every conversation until it is; asked for twice, it is still one wait.
function waitingRestart(): { begin: () => void; callOff: () => void } {
  let callOff: (() => void) | null = null;
  return {
    begin: () => {
      callOff ??= whenIdle(
        () => bridge.flow.activeCount(),
        () => void shutDown("restart"),
      );
    },
    callOff: () => {
      callOff?.();
      callOff = null;
    },
  };
}
const restartWait = waitingRestart();

// A restart nothing would follow is refused: the bridge would only be gone.
async function onStopRequest(request: StopRequest): Promise<void> {
  if (request.mode === "restart" && !supervised) {
    console.error(
      "A restart was asked for, but this bridge was started by hand and nothing would start it again. It keeps running. " +
        "Stop it with `npm run stop` and start it yourself, or install the service the README names and ask again.",
    );
    return;
  }
  const asker = request.sessionId ? askerFor(bridge, request.sessionId) : null;
  if (asker) await bridge.restartNote.add(asker);
  if (request.mode !== "restart") {
    // A stop asked for while a restart waits is the last word, and what it stops stays stopped.
    restartWait.callOff();
    await shutDown(request.mode);
    return;
  }
  restartWait.begin();
}
// A crash leaves the lock behind on purpose: its heartbeat goes stale and the next start takes it over.
const stopWatch = watchForStop(lockPath, (request) => {
  onStopRequest(request).catch((error: unknown) => console.error("a stop request could not be acted on", error));
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutDown("drain"));
}

// One conversation's stray failure must not end every other conversation's turn, which is what Node does with a rejection nobody handled.
process.on("unhandledRejection", (reason) => console.error("unhandled rejection, bridge kept running", reason));

// A gateway error with no listener is an unhandled rejection, which would take the bridge down.
client.on(Events.Error, (error) => console.error("discord client error", error));
client.on(Events.ShardDisconnect, (event, id) => console.error(`shard ${id} disconnected`, event.code));
client.on(Events.ShardReconnecting, (id) => console.log(`shard ${id} reconnecting`));

client.once(Events.ClientReady, (ready) => {
  void startUp(bridge, ready).catch((error: unknown) => console.error("the bridge did not finish starting up", error));
});

client.on(Events.GuildCreate, (guild) => {
  void onServerJoined(bridge, guild.client, guild.id).catch((error: unknown) => {
    console.error("joining a server could not be acted on", error);
  });
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(bridge, message).catch((error: unknown) => {
    console.error("message handler failed", error);
  });
});

client.on(Events.ChannelDelete, (channel) => {
  // A voice channel's deletion leaves the conversation bound through its text channel, so only the text channel's is told.
  const unbinding = bridge.store.byChannel(channel.id);
  const bound = unbinding?.channels.text === channel.id ? unbinding : undefined;
  void bridge.store
    .unbind(channel.id)
    .then(() => {
      if (bound) console.log(`Unbound ${bound.sessionId}: its channel was deleted.`);
    })
    .catch((error: unknown) => {
      console.error("failed to unbind deleted channel", error);
    });
});

client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(bridge, interaction).catch((error: unknown) => {
    console.error("interaction handler failed", error);
  });
});

await client.login(config.botToken);
