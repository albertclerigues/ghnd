import { describe, expect, it } from "bun:test";
import { StubSummarizer } from "../../src/summarizer/stub.js";

describe("StubSummarizer", () => {
  it("produces deterministic output from input", async () => {
    const stub = new StubSummarizer();
    const result = await stub.summarize({
      description: "Fix the widget rendering bug",
      comments: [
        { number: 1, body: "I can reproduce this easily" },
        { number: 2, body: "Fixed in latest commit" },
      ],
    });

    expect(result.descriptionSummary).toBe("Summary: Fix the widget rendering bug");
    expect(result.comments.length).toBe(2);
    expect(result.comments[0]?.commentNumber).toBe(1);
    expect(result.comments[0]?.summary).toBe("Comment 1: I can reproduce");
    expect(result.comments[1]?.commentNumber).toBe(2);
    expect(result.comments[1]?.summary).toBe("Comment 2: Fixed in latest");
  });

  it("tracks calls", async () => {
    const stub = new StubSummarizer();
    const content = { description: "test", comments: [] };
    await stub.summarize(content);
    await stub.summarize(content);

    expect(stub.calls.length).toBe(2);
    expect(stub.calls[0]).toBe(content);
  });

  it("handles empty content", async () => {
    const stub = new StubSummarizer();
    const result = await stub.summarize({
      description: "",
      comments: [],
    });

    expect(result.descriptionSummary).toBe("Summary: ");
    expect(result.comments.length).toBe(0);
  });
});
