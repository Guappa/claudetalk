import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runTurn } from "../../src/claude/runner.ts";
import { SessionIndex } from "../../src/sessions/index.ts";
import { expandShortPath } from "../../src/platform.ts";

const sessionId = randomUUID();
const settings = { model: "haiku" };
let cwd: string;

async function turn(prompt: string, resume: boolean, name?: string) {
  const { done } = runTurn(
    { sessionId, cwd, prompt, settings, resume, name },
    () => {},
  );
  return await done;
}

describe("real session lifecycle", () => {
  it("creates a named session and gets a reply", async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cdb-int-"));
    const result = await turn("Reply with exactly: ALPHA", false, "integration-probe");
    expect(result.ok ? "" : result.error.message).toBe("");
    expect(result.ok).toBe(true);
    expect(result.text).toContain("ALPHA");
  });

  it("resumes the same session in a new process and retains context", async () => {
    const result = await turn("What single word did you just reply? Only that word.", true);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("ALPHA");
  });

  it("passes a slash command through to the session", async () => {
    const result = await turn("/context", true);
    expect(result.ok).toBe(true);
    expect(result.text.toLowerCase()).toContain("context");
  });

  it("reports token usage and cost, which the context tracker depends on", async () => {
    const result = await turn("Reply with exactly: BETA", true);
    expect(result.usage?.cache_read_input_tokens).toBeGreaterThanOrEqual(0);
    expect(result.sessionCostUsd).toBeGreaterThan(0);
  });

  it("appears in the session index with the name it was created with", async () => {
    const records = await new SessionIndex().build();
    const found = records.find((record) => record.sessionId === sessionId);
    expect(found?.name).toBe("integration-probe");
    expect(found?.cwd).toBe(expandShortPath(cwd));
  });
});

afterAll(async () => {
  const root = path.join(os.homedir(), ".claude", "projects");

  for (const dir of await fs.readdir(root).catch(() => [])) {
    const projectDir = path.join(root, dir);
    const transcript = path.join(projectDir, `${sessionId}.jsonl`);

    // Only a directory this run actually created is removed, never one that merely looks empty.
    const ownedByThisRun = await fs
      .stat(transcript)
      .then(() => true)
      .catch(() => false);
    if (!ownedByThisRun) continue;

    await fs.rm(transcript, { force: true });
    const remaining = await fs.readdir(projectDir).catch(() => ["keep"]);
    if (remaining.every((entry) => entry === "memory")) {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }

  if (cwd) await fs.rm(cwd, { recursive: true, force: true });
});
