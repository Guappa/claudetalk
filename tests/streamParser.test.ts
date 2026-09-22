import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { toolUses, assistantText } from "../src/claude/streamParser.ts";
import { compactMetadata, isCompactionStart, isInit, type ClaudeEvent } from "../src/claude/events.ts";

const events: ClaudeEvent[] = fs
  .readFileSync(path.join(import.meta.dirname, "fixtures/stream-compact.ndjson"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("{"))
  .map((line) => JSON.parse(line) as ClaudeEvent);

describe("event helpers", () => {
  it("identifies the compaction start", () => {
    expect(events.filter(isCompactionStart)).toHaveLength(1);
  });

  it("extracts compact metadata", () => {
    const metadata = events.map(compactMetadata).find(Boolean);
    expect(metadata?.trigger).toBe("manual");
    expect(metadata?.cumulative_dropped_tokens).toBe(20918);
  });

  it("identifies the init event and its terminal-only commands", () => {
    const init = events.find(isInit);
    expect(init?.terminal_slash_commands).toEqual(["doctor", "color", "reload-plugins"]);
  });

  it("extracts tool names from assistant events", () => {
    expect(events.flatMap((event) => toolUses(event).map((block) => block.name))).toEqual(["Read"]);
  });

  it("extracts assistant text", () => {
    expect(events.map(assistantText).join("")).toBe("Done.");
  });

  it("parses the result event accounting", () => {
    const result = events.find((event) => event.type === "result");
    expect(result?.type === "result" && result.usage.cache_read_input_tokens).toBe(8000);
    expect(result?.type === "result" && result.total_cost_usd).toBeCloseTo(0.0255568);
  });
});
