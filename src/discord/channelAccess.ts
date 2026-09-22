import { PermissionFlagsBits, type OverwriteResolvable } from "discord.js";

const PARTICIPANT = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
];

const BOT = [...PARTICIPANT, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages];

export interface ConversationAudience {
  everyoneRoleId: string;
  botUserId: string;
  ownerId: string;
  memberIds: string[];
}

export function conversationOverwrites(audience: ConversationAudience): OverwriteResolvable[] {
  const participants = [...new Set([audience.ownerId, ...audience.memberIds])];

  return [
    { id: audience.everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
    { id: audience.botUserId, allow: BOT },
    ...participants.map((id) => ({ id, allow: PARTICIPANT })),
  ];
}
