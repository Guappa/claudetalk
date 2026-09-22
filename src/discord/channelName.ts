const MAX_CHANNEL_NAME = 90;

export function toChannelName(conversationName: string): string {
  const slug = conversationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CHANNEL_NAME);
  return slug || "conversation";
}

export function fromChannelName(channelName: string): string {
  return channelName.replace(/-/g, " ");
}
