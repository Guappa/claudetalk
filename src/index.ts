import { Client, Events, GatewayIntentBits, Options } from "discord.js";
import { loadConfig } from "./config.ts";
import { acquireInstanceLock, lockPathBeside, STALE_AFTER_MS } from "./instanceLock.ts";
import { takeStopRequest, watchForStop, type StopMode } from "./stopSignal.ts";
import { createBridge } from "./bridge.ts";
import { sweepAttachments } from "./attachments.ts";
import { handleMessage } from "./discord/handlers/message.ts";
import { handleInteraction } from "./discord/handlers/interaction.ts";
import { startUp } from "./discord/startup.ts";
import { describeClaudeVersions } from "./claude/versions.ts";
import { count } from "./text.ts";

const config = loadConfig();
const lockPath = lockPathBeside(config.bindingsPath);
const lock = await acquireInstanceLock(lockPath);
// A request left over from a previous run would stop this one on its first tick; cleared only once the lock is ours, or a start that is refused would eat the running bridge's.
await takeStopRequest(lockPath);

console.log(`Owners: ${config.ownerIds.join(", ")}.`);

const bridge = await createBridge(config);
console.log(
  `Language: ${bridge.language.current()} (${bridge.language.wasPicked() ? "picked with /language" : "host default"}).`,
);
console.log(describeClaudeVersions(bridge.claude));
await sweepAttachments();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
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
  return async (mode) => {
    if (mode === "now") bridge.flow.stopAll();
    if (started) return;
    started = true;
    const turns = bridge.flow.activeCount();
    if (turns > 0) console.log(`stopping after ${count(turns, "running turn")}`);
    await bridge.flow.drain((left) => void lock.noteDraining(left).catch(() => undefined));
    clearInterval(stopWatch);
    console.log("stopped");
    await client.destroy();
    await lock.release();
    process.exit(0);
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
// A crash leaves the lock behind on purpose: its heartbeat goes stale and the next start takes it over.
const stopWatch = watchForStop(lockPath, (mode) => void shutDown(mode));
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

client.on(Events.MessageCreate, (message) => {
  handleMessage(bridge, message).catch((error: unknown) => {
    console.error("message handler failed", error);
  });
});

client.on(Events.ChannelDelete, (channel) => {
  void bridge.store.unbind(channel.id).catch((error: unknown) => {
    console.error("failed to unbind deleted channel", error);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(bridge, interaction).catch((error: unknown) => {
    console.error("interaction handler failed", error);
  });
});

await client.login(config.botToken);
