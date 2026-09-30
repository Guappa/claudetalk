export function isFromGuild(config: { guildId: string }, guildId: string | null, isBot: boolean): boolean {
  if (isBot) return false;
  return guildId === config.guildId;
}
