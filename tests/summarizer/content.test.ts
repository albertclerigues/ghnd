import { describe, expect, it } from "bun:test";
import { assembleContent } from "../../src/summarizer/content.js";

describe("assembleContent", () => {
  it("formats description only", () => {
    const result = assembleContent({
      description: "Bug in rendering",
      comments: [],
    });
    expect(result).toBe("## Description\nBug in rendering");
  });

  it("formats description and comments", () => {
    const result = assembleContent({
      description: "Bug report",
      comments: [
        { number: 1, body: "I can reproduce this" },
        { number: 2, body: "Fixed in PR #10" },
      ],
    });
    expect(result).toContain("## Description\nBug report");
    expect(result).toContain("## Comment 1\nI can reproduce this");
    expect(result).toContain("## Comment 2\nFixed in PR #10");
  });

  it("handles empty description", () => {
    const result = assembleContent({ description: "", comments: [] });
    expect(result).toContain("(empty)");
  });
});
