import { RESTJSONErrorCodes, type Client } from "discord.js";
import type { Bridge } from "../bridge.ts";
import { errorMessage } from "../text.ts";
import { markInterrupted } from "./activeTurns.ts";
import { bridgeCommandDefinitions } from "./commands/registry.ts";
import { inviteUrl } from "./invite.ts";
import { watchOutboxes } from "./outboxWatcher.ts";
import { announceRestart } from "./restart.ts";

async function registerCommands(bridge: Bridge, client: Client<true>): Promise<boolean> {
  try {
    await client.application.commands.set(bridgeCommandDefinitions(), bridge.config.guildId);
    return true;
  } catch (error) {
    console.error(
      `The slash commands could not be registered: ${errorMessage(error)}. The bridge still answers messages, but its commands are missing or out of date. ` +
        `The usual cause is a bot invited without the applications.commands scope: open this link again, then restart the bridge.\n${inviteUrl(client, bridge.config.guildId)}`,
    );
    return false;
  }
}

// A bot that is in no server yet has nowhere to register its commands, and the one thing left to do is to add it.
function sayHowToJoin(bridge: Bridge, client: Client<true>): void {
  console.log(
    `The bot is not in server ${bridge.config.guildId} yet. Open this link to add it, with the permissions the bridge needs already chosen:\n` +
      `${inviteUrl(client, bridge.config.guildId)}\n` +
      "The commands register as soon as it joins. If the link names a server that is not yours, DISCORD_GUILD_ID in .env holds the wrong id.",
  );
}

// Added while it runs, the bot registers its commands at once, so a first start needs no restart after the invite.
export async function onServerJoined(bridge: Bridge, client: Client<true>, guildId: string): Promise<void> {
  if (guildId !== bridge.config.guildId) return;
  if (await registerCommands(bridge, client)) console.log(`Added to server ${guildId}. Commands registered.`);
}

// Only Discord saying the channel does not exist counts: a fetch that failed for any other reason says nothing about it.
function isGone(client: Client<true>, channelId: string): Promise<boolean> {
  return client.channels.fetch(channelId).then(
    (channel) => channel === null,
    (error: unknown) => (error as { code?: unknown }).code === RESTJSONErrorCodes.UnknownChannel,
  );
}

// A channel deleted while the bridge was not running left its binding behind, and its conversation would read as open in a channel nobody can reach.
async function forgetDeletedChannels(bridge: Bridge, client: Client<true>): Promise<void> {
  const conversations = bridge.store.all();
  const gone = await Promise.all(conversations.map((conversation) => isGone(client, conversation.channels.text)));
  for (const [index, conversation] of conversations.entries()) {
    if (!gone[index]) continue;
    await bridge.store.unbind(conversation.channels.text);
    console.log(`Unbound ${conversation.sessionId}: its channel was deleted while the bridge was not running.`);
  }
}

// Each step stands alone: commands that could not be registered are no reason to leave interrupted turns unmarked or the outboxes unwatched.
export async function startUp(bridge: Bridge, client: Client<true>): Promise<NodeJS.Timeout> {
  const present = client.guilds.cache.has(bridge.config.guildId);
  if (!present) sayHowToJoin(bridge, client);
  const registered = present && (await registerCommands(bridge, client));
  await forgetDeletedChannels(bridge, client).catch((error: unknown) => {
    console.error(`Bindings could not be checked against the channels that still exist: ${errorMessage(error)}`);
  });
  await markInterrupted(client, await bridge.activeTurns.takeLeftovers(), bridge.language.say);
  await announceRestart(client, await bridge.restartNote.take(), bridge.build, bridge.language.say);
  const watching = watchOutboxes(bridge, client);
  const ready = `Ready as ${client.user.tag} on v${bridge.build}.`;
  if (registered) console.log(`${ready} Commands registered to guild ${bridge.config.guildId}.`);
  else if (present) console.log(`${ready} Commands are NOT registered; see above.`);
  else console.log(`${ready} Waiting to be added to server ${bridge.config.guildId}; the link is above.`);
  return watching;
}
