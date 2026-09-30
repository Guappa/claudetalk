// Discord draws these in each reader's own zone and language: the date with the time, or how long ago it was.
export function dateAndTime(at: Date): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:f>`;
}

export function howLongAgo(at: Date): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:R>`;
}
