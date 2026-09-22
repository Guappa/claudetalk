export interface GateConfig {
  guildId: string;
  categoryId?: string;
}

export function isFromGuild(config: GateConfig, guildId: string | null, isBot: boolean): boolean {
  if (isBot) return false;
  return guildId === config.guildId;
}

// Scoping stops this bridge auto-binding inside another bridge's channels; commands use tiers.
export function isMessageInScope(
  config: GateConfig,
  channelParentId: string | null,
  isBound: boolean,
): boolean {
  if (isBound) return true;
  if (!config.categoryId) return true;
  return channelParentId === config.categoryId;
}
