export function count(quantity: number, noun: string, plural = `${noun}s`): string {
  return `${quantity} ${quantity === 1 ? noun : plural}`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// discord.js and fs reject with Error, but a store or a script can surface a bare string.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
