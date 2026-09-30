import type { InitEvent, SessionCommand } from "./events.ts";
import { orderedWriter, readJsonOr } from "../jsonFile.ts";
import { errorMessage } from "../text.ts";

const FALLBACK_TERMINAL_ONLY = ["doctor", "color", "reload-plugins"];

export class CapabilityCache {
  private readonly bySession = new Map<string, InitEvent>();
  private byFolder: Record<string, SessionCommand[]> = {};
  private readonly filePath: string | null;
  private readonly write: ((value: unknown) => Promise<void>) | null;

  // Without a path nothing outlives the process, which is what a test wants.
  constructor(filePath: string | null = null) {
    this.filePath = filePath;
    this.write = filePath ? orderedWriter(filePath) : null;
  }

  async load(): Promise<void> {
    if (this.filePath) this.byFolder = await readJsonOr<Record<string, SessionCommand[]>>(this.filePath, () => ({}));
  }

  record(sessionId: string, init: InitEvent): void {
    this.bySession.set(sessionId, init);
  }

  terminalOnly(sessionId: string): string[] {
    return this.bySession.get(sessionId)?.terminal_slash_commands ?? FALLBACK_TERMINAL_ONLY;
  }

  skills(sessionId: string): string[] {
    return this.bySession.get(sessionId)?.skills ?? [];
  }

  model(sessionId: string): string | undefined {
    return this.bySession.get(sessionId)?.model;
  }

  // Commands follow the folder and what is installed for it, not the session, so they survive a restart and a new conversation there has them at once.
  async recordCommands(cwd: string, commands: SessionCommand[]): Promise<void> {
    if (JSON.stringify(this.byFolder[cwd]) === JSON.stringify(commands)) return;
    this.byFolder[cwd] = commands;
    if (!this.write) return;
    // A failed write costs a log line, not the turn that learned the commands.
    await this.write({ ...this.byFolder }).catch((error: unknown) => {
      console.error(`could not write ${this.filePath}: ${errorMessage(error)}`);
    });
  }

  commands(cwd: string): SessionCommand[] {
    return this.byFolder[cwd] ?? [];
  }
}
