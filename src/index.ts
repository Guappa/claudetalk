import { Client, Events, GatewayIntentBits, Options } from "discord.js";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { acquireInstanceLock, releaseInstanceLock } from "./instanceLock.ts";
import { takeStopRequest, watchForStop } from "./stopSignal.ts";
import { createBridge } from "./bridge.ts";
import { sweepAttachments } from "./attachments.ts";
import { bridgeCommandDefinitions } from "./discord/commands/registry.ts";
import { handleMessage } from "./discord/handlers/message.ts";
import { handleInteraction } from "./discord/handlers/interaction.ts";
import { watchOutboxes } from "./discord/outboxWatcher.ts";
import { bridgeVersion } from "./version.ts";

const config = loadConfig();
const lockPath = path.join(path.dirname(config.bindingsPath), "bridge.lock");
// A request left over from a previous run would stop this one on its first tick.
await takeStopRequest(lockPath);
const heartbeat = await acquireInstanceLock(lockPath);

console.log(`Owners: ${config.ownerIds.join(", ")}.`);

const bridge = await createBridge(config);
await sweepAttachments();

// A crash leaves the lock behind on purpose: its heartbeat goes stale and the next start takes it over.
const stopWatch = watchForStop(lockPath, shutDown);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, shutDown);
}

function shutDown(): void {
  clearInterval(heartbeat);
  clearInterval(stopWatch);
  void releaseInstanceLock(lockPath).then(() => process.exit(0));
}

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

// A gateway error with no listener is an unhandled rejection, which would take the bridge down.
client.on(Events.Error, (error) => console.error("discord client error", error));
client.on(Events.ShardDisconnect, (event, id) => console.error(`shard ${id} disconnected`, event.code));
client.on(Events.ShardReconnecting, (id) => console.log(`shard ${id} reconnecting`));

client.once(Events.ClientReady, async (ready) => {
  await ready.application.commands.set(bridgeCommandDefinitions(), config.guildId);
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
