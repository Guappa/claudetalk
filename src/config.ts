export interface Config {
  botToken: string;
  guildId: string;
  ownerIds: string[];
  projectsRoot: string;
  bindingsPath: string;
  operatorsPath: string;
  toolApprovals: boolean;
  categoryId?: string;
  workspacesRoot?: string;
}

const SNOWFLAKE = /^[0-9]{17,20}$/;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(
      `${key} is not set. Copy .env.example to .env and fill it in; README.md says where each value comes from.`,
    );
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
      `CLAUDE_TOOL_APPROVALS is "${value}", which is neither true nor false. ` +
        `Set it in .env, then restart the bridge.`,
    );
  }
  return value === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    botToken: required(env, "DISCORD_BOT_TOKEN"),
    guildId: required(env, "DISCORD_GUILD_ID"),
    ownerIds: ownerIds(env),
    projectsRoot: required(env, "PROJECTS_ROOT"),
    bindingsPath: env.BINDINGS_PATH?.trim() || "data/conversations.json",
    operatorsPath: env.OPERATORS_PATH?.trim() || "data/operators.json",
    toolApprovals: toolApprovals(env),
    categoryId: env.DISCORD_CATEGORY_ID?.trim() || undefined,
    workspacesRoot: env.WORKSPACES_ROOT?.trim() || undefined,
  };
}
