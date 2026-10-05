import { OAuth2Scopes, PermissionFlagsBits, type Client } from "discord.js";

// Everything the bridge does in a server, and so everything the link asks for; the README says what each is for.
const NEEDED = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
];

// The link that adds the bot to the one server it serves, with the scopes and permissions already chosen, so nobody ticks them by hand.
export function inviteUrl(client: Client<true>, guildId: string): string {
  return client.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: NEEDED,
    guild: guildId,
    disableGuildSelect: true,
  });
}
