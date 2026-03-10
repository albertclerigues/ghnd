export interface SummaryResult {
  descriptionSummary: string;
  comments: Array<{
    commentNumber: number;
    summary: string;
  }>;
}

export interface ThreadContent {
  description: string;
  comments: Array<{
    number: number;
    body: string;
  }>;
}

export interface Summarizer {
  summarize(content: ThreadContent): Promise<SummaryResult>;
}
