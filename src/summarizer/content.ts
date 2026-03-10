import type { ThreadContent } from "./types.js";

export function assembleContent(content: ThreadContent): string {
  const parts: string[] = [];
  parts.push("## Description");
  parts.push(content.description || "(empty)");
  for (const comment of content.comments) {
    parts.push(`\n## Comment ${String(comment.number)}`);
    parts.push(comment.body);
  }
  return parts.join("\n");
}
