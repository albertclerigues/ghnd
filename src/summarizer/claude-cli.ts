import { assembleContent } from "./content.js";
import type { Summarizer, SummaryResult, ThreadContent } from "./types.js";

const SYSTEM_PROMPT =
  "You are a structured data extractor for a medical device startup's GitHub issues. The team builds AI-assisted neurological diagnostic software (MS lesion detection, brain volumetry, brain metastasis). Issues span engineering, regulatory (IFU, FMEA, CE marking), research (ML experiments, clinical validation), business (hospital outreach, conferences), and coordination. Extract information precisely. Never hallucinate. Be concise and maximize information density. Use active voice. Quote metrics, code snippets, and technical terms when relevant.";

const JSON_SCHEMA = JSON.stringify({
  type: "object",
  required: ["description_summary", "comments"],
  additionalProperties: false,
  properties: {
    description_summary: {
      type: "string",
      description: "One-sentence summary of the issue/PR/discussion description, max 10 words.",
    },
    comments: {
      type: "array",
      items: {
        type: "object",
        required: ["comment_number", "summary"],
        additionalProperties: false,
        properties: {
          comment_number: {
            type: "integer",
            description: "The sequential comment number as provided in the input.",
          },
          summary: {
            type: "string",
            description: "One-sentence summary of this comment, max 10 words.",
          },
        },
      },
    },
  },
});

const USER_PROMPT_TEMPLATE = `The following text was parsed from a GitHub issue/PR/discussion and its comments.

---
{content}
---

Summarize the description and each comment. Rules:
- description_summary: One sentence, max 10 words. Capture the core purpose. Active voice, no filler.
- comments: One summary per comment, in order. Max 10 words each. Focus on the content: decisions, action items, technical details, metrics. Quote code or numbers when relevant. Skip pleasantries.

Respond with valid JSON matching this schema:
${JSON_SCHEMA}`;

export class ClaudeCliSummarizer implements Summarizer {
  async summarize(content: ThreadContent): Promise<SummaryResult> {
    const assembled = assembleContent(content);
    const prompt = `${SYSTEM_PROMPT}\n\n${USER_PROMPT_TEMPLATE.replace("{content}", assembled)}`;

    const proc = Bun.spawn(["claude", "-p", "--output-format", "json", prompt], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`claude CLI exited with code ${String(exitCode)}: ${stderr}`);
    }

    // claude --output-format json returns { result: "..." } where result is the text response
    const cliOutput = JSON.parse(stdout) as { result: string };
    const text = cliOutput.result;

    // Extract JSON from the response (may be wrapped in markdown code block)
    const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const jsonStr = jsonMatch ? (jsonMatch[1] ?? "").trim() : text.trim();

    const parsed = JSON.parse(jsonStr) as {
      description_summary: string;
      comments: Array<{ comment_number: number; summary: string }>;
    };

    return {
      descriptionSummary: parsed.description_summary,
      comments: parsed.comments.map((c) => ({
        commentNumber: c.comment_number,
        summary: c.summary,
      })),
    };
  }
}
