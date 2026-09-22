import type { InitEvent } from "./events.ts";

const FALLBACK_TERMINAL_ONLY = ["doctor", "color", "reload-plugins"];

export class CapabilityCache {
  private readonly bySession = new Map<string, InitEvent>();

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
}
