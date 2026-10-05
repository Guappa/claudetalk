import { describe, expect, it } from "vitest";
import {
  listMcpServers,
  reconnectMcpServer,
  setMcpServerEnabled,
  settledServers,
  type McpSession,
  type McpState,
  type OpenSession,
} from "../src/claude/mcpServers.ts";
import { describeServer, mcpSelectOptions } from "../src/discord/commands/mcp.ts";
import { MCP_SELECT, mcpReconnectId, mcpToggleId, parseCustomId } from "../src/discord/menus.ts";
import { sayIn } from "../src/i18n/index.ts";

const say = sayIn("en");

type Reported = { name: string; status: McpState; error?: string; tools?: unknown[] };

// A session that answers from a list the test changes, and records what it was told to do.
function fakeSession(answers: Reported[][], onToggle?: (name: string, enabled: boolean) => void) {
  const told: string[] = [];
  let asked = 0;
  const session: McpSession = {
    mcpServerStatus: async () => {
      const answer = answers[Math.min(asked, answers.length - 1)]!;
      asked += 1;
      return answer;
    },
    toggleMcpServer: async (name, enabled) => {
      told.push(`${enabled ? "on" : "off"} ${name}`);
      onToggle?.(name, enabled);
    },
    reconnectMcpServer: async (name) => {
      told.push(`reconnect ${name}`);
    },
  };
  const open: OpenSession = (cwd, ask) => {
    told.push(`opened ${cwd}`);
    return ask(session);
  };
  return { session, open, told, timesAsked: () => asked };
}

const notes: Reported = { name: "notes", status: "connected", tools: [{}, {}, {}] };

describe("the MCP servers a folder has", () => {
  // Asked the moment it starts, a session calls most of its servers pending, which says nothing a person can use.
  it("waits for servers that are still connecting, and stops asking once none is", async () => {
    const connecting = { name: "notes", status: "pending" as const };
    const { session, timesAsked } = fakeSession([[connecting], [connecting], [notes]]);

    expect(await settledServers(session, 5_000, 1)).toEqual([{ name: "notes", state: "connected", tools: 3, error: "" }]);
    expect(timesAsked()).toBe(3);
  });

  it("gives the servers as they stand when the wait runs out, so one that never connects does not hold the answer", async () => {
    const { session } = fakeSession([[{ name: "notes", status: "pending" }]]);
    expect(await settledServers(session, 20, 1)).toEqual([{ name: "notes", state: "pending", tools: 0, error: "" }]);
  });

  it("asks in the conversation's folder, since the servers and what is switched off are the folder's", async () => {
    const failed = { name: "search", status: "failed" as const, error: "connection refused" };
    const { open, told } = fakeSession([[notes, failed]]);

    expect(await listMcpServers("/srv/app", open)).toEqual([
      { name: "notes", state: "connected", tools: 3, error: "" },
      { name: "search", state: "failed", tools: 0, error: "connection refused" },
    ]);
    expect(told).toEqual(["opened /srv/app"]);
  });

  it("switches a server off and reports what the session says of it afterwards", async () => {
    const { open, told } = fakeSession([[{ name: "notes", status: "disabled" }]]);

    expect(await setMcpServerEnabled("/srv/app", "notes", false, open)).toMatchObject({ name: "notes", state: "disabled" });
    expect(told).toEqual(["opened /srv/app", "off notes"]);
  });

  // Claude Code throws when a server it switched on cannot be reached, though the switch itself took.
  it("reports the state of a server switched on that could not connect, where the session calls the switch a failure", async () => {
    const { open } = fakeSession([[{ name: "notes", status: "needs-auth" }]], () => {
      throw new Error("Server status: needs-auth");
    });

    expect(await setMcpServerEnabled("/srv/app", "notes", true, open)).toMatchObject({ name: "notes", state: "needs-auth" });
  });

  it("says a server is gone when the folder no longer has it, and passes on a failure that leaves nothing to report", async () => {
    const quiet = fakeSession([[notes]]);
    expect(await reconnectMcpServer("/srv/app", "search", quiet.open)).toBeNull();
    expect(quiet.told).toEqual(["opened /srv/app", "reconnect search"]);

    const failing = fakeSession([[notes]], () => {
      throw new Error("no such server");
    });
    await expect(setMcpServerEnabled("/srv/app", "search", true, failing.open)).rejects.toThrow("no such server");
  });
});

describe("what /mcp shows", () => {
  const server = (state: McpState, extra: { tools?: number; error?: string } = {}) => ({
    name: "notes",
    state,
    tools: extra.tools ?? 0,
    error: extra.error ?? "",
  });

  it("lists each server with what it is doing, and counts the tools of one that is connected", () => {
    const options = mcpSelectOptions(say, [server("connected", { tools: 1 }), { ...server("needs-auth"), name: "search" }]);
    expect(options).toEqual([
      { label: "notes", value: "notes", description: "connected, 1 tool" },
      { label: "search", value: "search", description: "needs a sign-in" },
    ]);
  });

  it("keeps to what one menu holds", () => {
    const many = Array.from({ length: 40 }, (_unused, index) => ({ ...server("connected"), name: `server-${index}` }));
    expect(mcpSelectOptions(say, many)).toHaveLength(25);
  });

  it("says why a server is not working and what would change that", () => {
    expect(describeServer(say, server("connected", { tools: 4 }))).toBe("`notes` · connected, 4 tools");
    expect(describeServer(say, server("failed", { error: "connection refused" }))).toContain("connection refused");
    expect(describeServer(say, server("failed"))).toContain("unknown");
    expect(describeServer(say, server("needs-auth"))).toContain("cannot be given from Discord");
    expect(describeServer(say, server("disabled"))).toContain("switched off for this folder");
    expect(describeServer(say, server("pending"))).toContain("still connecting");
  });
});

describe("the controls /mcp draws", () => {
  it("reads a chosen server from the menu", () => {
    expect(parseCustomId(MCP_SELECT, "notes")).toEqual({ kind: "mcp-chosen", name: "notes" });
  });

  // A plugin's server is named with colons and a claude.ai connector with spaces and a dot.
  it("round-trips a server's name through its buttons, colons, spaces and dots included", () => {
    for (const name of ["notes", "plugin:search:search", "claude.ai Shared Drive"]) {
      expect(parseCustomId(mcpToggleId(name, true))).toEqual({ kind: "mcp-toggle", name, enable: true });
      expect(parseCustomId(mcpToggleId(name, false))).toEqual({ kind: "mcp-toggle", name, enable: false });
      expect(parseCustomId(mcpReconnectId(name))).toEqual({ kind: "mcp-reconnect", name });
    }
  });
});
