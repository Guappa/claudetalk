export function count(quantity: number, noun: string, plural = `${noun}s`): string {
  return `${quantity} ${quantity === 1 ? noun : plural}`;
}

// Never longer than max, its ellipsis included: the limit a caller passes is usually one Discord enforces.
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(max - 3, 0))}...` : text;
}

// For where nothing draws a time in the reader's zone: a date with it, and whose clock it is.
export function utcDateAndTime(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// discord.js and fs reject with Error, but a store or a script can surface a bare string.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// An error's own text can be as long as what caused it, and a reply that does not fit is refused, leaving no reply at all.
const SHOWN_ERROR_CHARS = 1200;

export function shownError(error: unknown): string {
  return truncate(errorMessage(error), SHOWN_ERROR_CHARS);
}
