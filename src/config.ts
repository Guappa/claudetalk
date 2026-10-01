import { parseDenials, type Denial } from "./claude/denials.ts";
import path from "node:path";
import { LANGUAGES, isLanguage, type Language } from "./i18n/index.ts";

export interface Config {
  botToken: string;
  guildId: string;
  ownerIds: string[];
  projectsRoot: string;
  bindingsPath: string;
  // Where the bridge's state lives: beside the bindings, so that moving them moves the lock, the language, the cache and the turns with them.
  dataDir: string;
  operatorsPath: string;
  toolApprovals: boolean;
  toolDenials: Set<Denial>;
  language: Language;
  categoryId?: string;
  workspacesRoot?: string;
}

const SNOWFLAKE = /^[0-9]{17,20}$/;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is not set. Copy .env.example to .env and fill it in; README.md says where each value comes from.`);
  }
  return value;
}

// Owners are the root of every access decision, so a typo has to fail at startup, not at first use.
function ownerIds(env: NodeJS.ProcessEnv): string[] {
  const ids = required(env, "DISCORD_OWNER_IDS")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const malformed = ids.filter((id) => !SNOWFLAKE.test(id));
  if (malformed.length > 0) {
    throw new Error(
      `DISCORD_OWNER_IDS contains something that is not a Discord user id: ${malformed.join(", ")}. ` +
        `An id is 17 to 20 digits. In Discord, enable Settings > Advanced > Developer Mode, then ` +
        `right-click yourself and choose Copy User ID.`,
    );
  }
  if (ids.length === 0) {
    throw new Error("DISCORD_OWNER_IDS is empty, so nobody could use the bridge.");
  }
  return ids;
}

// A turn runs with the host's rights either way; this decides whether an owner sees each step first.
function toolApprovals(env: NodeJS.ProcessEnv): boolean {
  const value = env.CLAUDE_TOOL_APPROVALS?.trim() || "false";
  if (value !== "true" && value !== "false") {
    throw new Error(
      `CLAUDE_TOOL_APPROVALS is "${value}", which is neither true nor false. Set it in .env, then restart the bridge.`,
    );
  }
  return value === "true";
}

// What the bridge itself says starts in this language, and stays in it until someone picks another in Discord.
function language(env: NodeJS.ProcessEnv): Language {
  const value = env.BRIDGE_LANGUAGE?.trim() || "en";
  if (!isLanguage(value)) {
    throw new Error(
      `BRIDGE_LANGUAGE is "${value}", which is not a language this bridge speaks. ` +
        `Use one of: ${Object.keys(LANGUAGES).join(", ")}. Set it in .env, then restart the bridge.`,
    );
  }
  return value;
}

// Where the bindings live decides where everything beside them lives, the lock included, so the stop script reads it the same way.
export function bindingsPathFrom(env: NodeJS.ProcessEnv): string {
  return env.BINDINGS_PATH?.trim() || "data/conversations.json";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    botToken: required(env, "DISCORD_BOT_TOKEN"),
    guildId: required(env, "DISCORD_GUILD_ID"),
    ownerIds: ownerIds(env),
    projectsRoot: required(env, "PROJECTS_ROOT"),
    bindingsPath: bindingsPathFrom(env),
    dataDir: path.dirname(bindingsPathFrom(env)),
    operatorsPath: env.OPERATORS_PATH?.trim() || path.join(path.dirname(bindingsPathFrom(env)), "operators.json"),
    toolApprovals: toolApprovals(env),
    toolDenials: parseDenials(env.TOOL_DENIALS),
    language: language(env),
    categoryId: env.DISCORD_CATEGORY_ID?.trim() || undefined,
    workspacesRoot: env.WORKSPACES_ROOT?.trim() || undefined,
  };
}
