export interface Addressing {
  mentionsBot: boolean;
  repliedAuthorId: string | null;
  botUserId: string;
  authorId: string;
}

// Two people talking in a shared conversation are not prompting it; tagging the bot brings it in.
export function addressesSomeoneElse(addressing: Addressing): boolean {
  if (addressing.mentionsBot) return false;
  const replied = addressing.repliedAuthorId;
  // Replying to yourself is carrying on your own thought, which the bot should still hear.
  return replied !== null && replied !== addressing.botUserId && replied !== addressing.authorId;
}

// Replying with the ping toggled off leaves nothing in mentions, so the reference decides too.
export function addressesBot(addressing: Addressing): boolean {
  if (addressing.mentionsBot) return true;
  return addressing.repliedAuthorId === addressing.botUserId;
}

// A reply to the bot needs no quoting: that message is already in the session's own history.
export function shouldQuoteReplied(addressing: Addressing): boolean {
  if (addressing.repliedAuthorId === null) return false;
  return addressing.repliedAuthorId !== addressing.botUserId;
}
