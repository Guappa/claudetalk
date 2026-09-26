import { Client, Events, GatewayIntentBits, Options } from "discord.js";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { acquireInstanceLock } from "./instanceLock.ts";
import { takeStopRequest, watchForStop, type StopMode } from "./stopSignal.ts";
import { createBridge } from "./bridge.ts";
import { sweepAttachments } from "./attachments.ts";
import { bridgeCommandDefinitions } from "./discord/commands/registry.ts";
import { handleMessage } from "./discord/handlers/message.ts";
import { handleInteraction } from "./discord/handlers/interaction.ts";
import { watchOutboxes } from "./discord/outboxWatcher.ts";
import { markInterrupted } from "./discord/activeTurns.ts";
import { count } from "./text.ts";
import { bridgeVersion } from "./version.ts";

const config = loadConfig();
const lockPath = path.join(path.dirname(config.bindingsPath), "bridge.lock");
// A request left over from a previous run would stop this one on its first tick.
await takeStopRequest(lockPath);
const lock = await acquireInstanceLock(lockPath);

console.log(`Owners: ${config.ownerIds.join(", ")}.`);

const bridge = await createBridge(config);
await sweepAttachments();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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

// A drain lets running turns finish; a second request, or "now", cuts them short and their messages say so.
function shutdownOnce(): (mode: StopMode) => Promise<void> {
  let started = false;
  return async (mode) => {
    if (mode === "now" || started) bridge.flow.stopAll();
    if (started) return;
    started = true;
    const turns = bridge.flow.activeCount();
    if (turns > 0) console.log(`stopping after ${count(turns, "running turn")}`);
    await bridge.flow.drain((left) => void lock.noteDraining(left));
    clearInterval(stopWatch);
    console.log("stopped");
    await client.destroy();
    await lock.release();
    process.exit(0);
  };
}

const shutDown = shutdownOnce();
// A crash leaves the lock behind on purpose: its heartbeat goes stale and the next start takes it over.
const stopWatch = watchForStop(lockPath, (mode) => void shutDown(mode));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutDown("drain"));
}

// A gateway error with no listener is an unhandled rejection, which would take the bridge down.
client.on(Events.Error, (error) => console.error("discord client error", error));
client.on(Events.ShardDisconnect, (event, id) => console.error(`shard ${id} disconnected`, event.code));
client.on(Events.ShardReconnecting, (id) => console.log(`shard ${id} reconnecting`));

client.once(Events.ClientReady, async (ready) => {
  await ready.application.commands.set(bridgeCommandDefinitions(), config.guildId);
  await markInterrupted(ready, await bridge.activeTurns.takeLeftovers());
  watchOutboxes(bridge, ready);
  console.log(
    `Ready as ${ready.user.tag} on v${bridgeVersion()}. ` +
      `Commands registered to guild ${config.guildId}.`,
  );
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
