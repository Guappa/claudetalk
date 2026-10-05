import { setTimeout as wait } from "node:timers/promises";
import { askSession } from "./runner.ts";

export type McpState = "connected" | "failed" | "needs-auth" | "pending" | "disabled";

export interface McpServer {
  name: string;
  state: McpState;
  tools: number;
  // Why it failed, in the server's or Claude Code's own words; empty for any other state.
  error: string;
}

// What a session answers when asked about its servers, and what it can be told to do with one.
export interface McpSession {
  mcpServerStatus(): Promise<Array<{ name: string; status: McpState; error?: string; tools?: unknown[] }>>;
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  reconnectMcpServer(serverName: string): Promise<void>;
}

export type OpenSession = <Answer>(cwd: string, ask: (session: McpSession) => Promise<Answer>) => Promise<Answer>;

// A session connects to its servers after it has started, and one asked at once calls most of them pending.
const SETTLE_MS = 8_000;
const SETTLE_POLL_MS = 400;

async function readServers(session: McpSession): Promise<McpServer[]> {
  return (await session.mcpServerStatus()).map((server) => ({
    name: server.name,
    state: server.status,
    tools: server.tools?.length ?? 0,
    error: server.error ?? "",
  }));
}

// The servers once none is still connecting, or as they stand when the wait runs out.
export async function settledServers(
  session: McpSession,
  settleMs: number = SETTLE_MS,
  pollMs: number = SETTLE_POLL_MS,
): Promise<McpServer[]> {
  const deadline = Date.now() + settleMs;
  let servers = await readServers(session);
  while (servers.some((server) => server.state === "pending") && Date.now() < deadline) {
    await wait(pollMs);
    servers = await readServers(session);
  }
  return servers;
}

export async function listMcpServers(cwd: string, open: OpenSession = askSession): Promise<McpServer[]> {
  return await open(cwd, (session) => settledServers(session));
}

// Claude Code reports a server it switched on but could not reach as a failure of the switch; the state read back afterwards is what tells the two apart.
async function afterChange(session: McpSession, name: string, change: () => Promise<void>): Promise<McpServer | null> {
  const complaint = await change().then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  const server = (await settledServers(session)).find((candidate) => candidate.name === name) ?? null;
  if (!server && complaint) throw new Error(complaint);
  return server;
}

// Kept by Claude Code for the folder, so it holds for every later session there, a terminal's included. Null when the folder has no such server.
export async function setMcpServerEnabled(
  cwd: string,
  name: string,
  enabled: boolean,
  open: OpenSession = askSession,
): Promise<McpServer | null> {
  return await open(cwd, (session) => afterChange(session, name, () => session.toggleMcpServer(name, enabled)));
}

export async function reconnectMcpServer(cwd: string, name: string, open: OpenSession = askSession): Promise<McpServer | null> {
  return await open(cwd, (session) => afterChange(session, name, () => session.reconnectMcpServer(name)));
}
