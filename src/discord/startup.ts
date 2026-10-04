import { RESTJSONErrorCodes, type Client } from "discord.js";
import type { Bridge } from "../bridge.ts";
import { errorMessage } from "../text.ts";
import { markInterrupted } from "./activeTurns.ts";
import { bridgeCommandDefinitions } from "./commands/registry.ts";
import { watchOutboxes } from "./outboxWatcher.ts";
import { announceRestart } from "./restart.ts";

async function registerCommands(bridge: Bridge, client: Client<true>): Promise<boolean> {
  try {
    await client.application.commands.set(bridgeCommandDefinitions(), bridge.config.guildId);
    return true;
  } catch (error) {
    console.error(
      `The slash commands could not be registered: ${errorMessage(error)}. The bridge still answers messages, but its commands are missing or out of date. ` +
        "The usual cause is a bot invited without the applications.commands scope: open the invite URL from the README again, then restart the bridge.",
    );
    return false;
  }
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
  const registered = await registerCommands(bridge, client);
  await forgetDeletedChannels(bridge, client).catch((error: unknown) => {
    console.error(`Bindings could not be checked against the channels that still exist: ${errorMessage(error)}`);
  });
  await markInterrupted(client, await bridge.activeTurns.takeLeftovers(), bridge.language.say);
  await announceRestart(client, await bridge.restartNote.take(), bridge.build, bridge.language.say);
  const watching = watchOutboxes(bridge, client);
  const ready = `Ready as ${client.user.tag} on v${bridge.build}.`;
  if (registered) console.log(`${ready} Commands registered to guild ${bridge.config.guildId}.`);
  else console.log(`${ready} Commands are NOT registered; see above.`);
  return watching;
}
