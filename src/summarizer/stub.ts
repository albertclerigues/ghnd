import type { Summarizer, SummaryResult, ThreadContent } from "./types.js";

export class StubSummarizer implements Summarizer {
  readonly calls: ThreadContent[] = [];

  async summarize(content: ThreadContent): Promise<SummaryResult> {
    this.calls.push(content);
    const descWords = content.description.split(/\s+/).slice(0, 5).join(" ");
    return {
      descriptionSummary: `Summary: ${descWords}`,
      comments: content.comments.map((c) => ({
        commentNumber: c.number,
        summary: `Comment ${String(c.number)}: ${c.body.split(/\s+/).slice(0, 3).join(" ")}`,
      })),
    };
  }
}
