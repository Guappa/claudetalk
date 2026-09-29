// Discord parses a message as one run of inline rules, so a marker left open in one stretch closes wherever the next one is, fences included.
export function defuseStrayMarkup(text: string): string {
  return text
    .split(FENCE)
    .map((part, index) => (index % 2 === 1 ? part : defuseStretch(part)))
    .join("");
}

const FENCE = /(```[\s\S]*?```)/;
const ESCAPABLE = /[^0-9A-Za-z\s]/;

const INLINE_CODE = /^(`+)([\s\S]*?[^`])\1(?!`)/;
const STRONG = /^\*\*([\s\S]+?)\*\*(?!\*)/;
const EM_STAR = /^\*(?=\S)((?:\*\*|\\[\s\S]|\s+(?:\\[\s\S]|[^\s*\\]|\*\*)|[^\s*\\])+?)\*(?!\*)/;
const UNDERLINE = /^__([\s\S]+?)__(?!_)/;
const EM_UNDERSCORE = /^_((?:__|\\[\s\S]|[^\\_])+?)_\b/;
const STRIKE = /^~~([\s\S]+?)~~(?!~)/;
const SPOILER = /^\|\|([\s\S]+?)\|\|/;
const LINK = /^\[((?:\[[^\]]*\]|[^[\]]|\](?=[^[]*\]))*)\]\(\s*<?((?:\([^)]*\)|[^\s\\]|\\.)*?)>?(?:\s+['"][\s\S]*?['"])?\s*\)/;
const ANGLE_TOKEN = /^<(?:[^: >]+:\/[^ >]+|@[!&]?\d+|#\d+|a?:\w+:\d+|t:-?\d+(?::[tTdDfFR])?|\/[\w -]+:\d+)>/;
const BARE_URL = /^https?:\/\/[^\s<]+[^<.,:;"')\]\s]/;

// Markers that open something and have to close; the first rule that closes within the stretch wins, as in Discord.
const OPENERS: Record<string, RegExp[]> = {
  "`": [INLINE_CODE],
  "*": [STRONG, EM_STAR],
  _: [UNDERLINE, EM_UNDERSCORE],
  "~": [STRIKE],
  "|": [SPOILER],
  "[": [LINK],
};

// Tokens Discord takes whole, so nothing inside them is a marker.
const OPAQUE: Record<string, RegExp> = { "<": ANGLE_TOKEN, "h": BARE_URL };

function defuseStretch(prose: string): string {
  let result = "";
  let index = 0;
  while (index < prose.length) {
    const char = prose[index]!;
    const rest = prose.slice(index);

    if (char === "\\" && ESCAPABLE.test(prose[index + 1] ?? "")) {
      result += rest.slice(0, 2);
      index += 2;
      continue;
    }

    const whole = OPAQUE[char]?.exec(rest)?.[0] ?? closedSpan(char, rest);
    if (whole) {
      result += whole;
      index += whole.length;
      continue;
    }

    const lineSoFar = prose.slice(prose.lastIndexOf("\n", index - 1) + 1, index);
    if (char in OPENERS && opens(char, rest, lineSoFar)) {
      const run = char === "`" ? /^`+/.exec(rest)![0] : char;
      result += run.replace(/./g, (marker) => `\\${marker}`);
      index += run.length;
      continue;
    }

    result += char;
    index += 1;
  }
  return result;
}

function closedSpan(char: string, rest: string): string | null {
  for (const rule of OPENERS[char] ?? []) {
    const match = rule.exec(rest);
    if (match) return match[0];
  }
  return null;
}

// A lone tilde or bar opens nothing, and a star that starts a line before a space is a list bullet.
function opens(char: string, rest: string, lineSoFar: string): boolean {
  if (char === "~" || char === "|") return rest[1] === char;
  if (char === "*") return !(rest[1] === " " && lineSoFar.trim() === "");
  return true;
}
