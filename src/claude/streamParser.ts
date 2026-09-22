import type { ClaudeEvent, ContentBlock } from "./events.ts";

function contentBlocks(event: ClaudeEvent): ContentBlock[] {
  if (event.type !== "assistant" && event.type !== "user") return [];
  const content = event.message?.content;
  return Array.isArray(content) ? content : [];
}

export function toolUses(event: ClaudeEvent): Array<Extract<ContentBlock, { type: "tool_use" }>> {
  return contentBlocks(event).filter(
    (block): block is Extract<ContentBlock, { type: "tool_use" }> => block.type === "tool_use",
  );
}

export function assistantText(event: ClaudeEvent): string {
  if (event.type !== "assistant") return "";
  return contentBlocks(event)
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}
