# Phase 4: LLM Integration — Implementation Plan

## Overview

Add LLM-powered summarization to GitHub notifications using the Anthropic API. The summarizer takes the full thread content (issue/PR description + comments), produces a one-line description summary and per-comment summaries, and stores them in the database. Summaries appear in the UI next to notification titles and event lines with a sparkle emoji and muted styling.

## Current State Analysis

The summary scaffold already exists end-to-end:

| Layer | File | Status |
|---|---|---|
| DB column `summary` | `src/db/schema.ts:42` | Exists, always NULL |
| Row type | `src/db/types.ts:46` | `summary: string \| null` |
| Upsert query | `src/db/queries.ts:91,105` | Reads/writes summary |
| Poller write | `src/poller/notifications.ts:126` | Hardcoded `null` with "Phase 4" comment |
| RPC type | `src/shared/rpc.ts:21` | `summary: string \| null` |
| RPC handler | `src/bun/index.ts:46` | Maps `e.summary` |
| WebView render | `src/mainview/index.ts:121-124` | Conditional `✨` span |
| CSS | `src/mainview/index.css:172-176` | `.event-summary` styled |

### What's Missing

1. **No summarizer module** — no Anthropic SDK dependency, no interface, no implementation
2. **No `description_summary` on notifications table** — only event-level summaries exist
3. **No way to fetch issue/PR body** — `GitHubClient` only has `getTimelineEvents`, which doesn't include the original description
4. **No async summarization** in the poller — currently synchronous store-and-move-on
5. **CSS color for summaries** is `var(--text)` (full brightness) — should be muted

### Key Discoveries

- The prompt in `docs/summary-prompt.json` uses structured output (JSON schema) returning `{ description_summary, comments: [{ comment_number, summary }] }`
- Timeline events with `event_type === "comment"` have `body` fields containing comment text
- The poller already iterates events and could track comment indices for mapping summaries back to event rows
- Electrobun's RPC layer already passes `summary` through — once the DB has real values, the UI will render them

## Desired End State

After this plan is complete:

1. New notifications are summarized automatically during polling
2. Each notification header shows a sparkle-prefixed description summary in muted text
3. Each event line with a comment body shows a sparkle-prefixed summary in muted text
4. Summarization is async — notifications appear immediately, summaries backfill
5. A contract stub allows all tests to run without hitting the Anthropic API
6. When the API is unavailable, notifications still work (summaries remain null)

### Verification

- `bun run check` passes
- `bun run typecheck` passes
- `bun test` passes (all existing + new tests)
- Running `bun run dev` shows notifications with summaries populated

## What We're NOT Doing

- **Caching/deduplication of LLM calls** — we summarize each time a notification is processed; a smarter cache can come later
- **Configurable summarizer backend** — hardcoded to Anthropic for now; the interface makes swapping easy later
- **Retry logic for failed summarizations** — if the API call fails, summary stays null; next poll cycle will retry
- **Summarizing notifications without parseable subject URLs** — only issues/PRs with timeline events get summaries
- **Rate limiting LLM calls** — the GitHub poll interval (15 min) naturally throttles; explicit rate limiting is deferred

## Implementation Approach

The summarizer is injected as a dependency into the `NotificationPoller`. After storing all events for a notification, the poller assembles the thread content (description + comment bodies), calls the summarizer, and writes results back to the DB. Summarization happens asynchronously (fire-and-forget per notification) so it doesn't block the poll loop.

---

## Phase 4.1: Summarizer Module

### Overview

Create the summarizer interface, Anthropic implementation, contract stub for tests, and content assembly utility.

### Changes Required

#### 4.1.1 Install Anthropic SDK

```bash
bun add @anthropic-ai/sdk
```

#### 4.1.2 Summarizer Types

**File**: `src/summarizer/types.ts`

```ts
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

/**
 * Summarizes a GitHub issue/PR thread into one-line summaries
 * for the description and each comment.
 */
export interface Summarizer {
  summarize(content: ThreadContent): Promise<SummaryResult>;
}
```

#### 4.1.3 Content Assembly

**File**: `src/summarizer/content.ts`

Formats a `ThreadContent` into the text block expected by the prompt template:

```ts
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
```

#### 4.1.4 Anthropic Summarizer

**File**: `src/summarizer/anthropic.ts`

Uses `@anthropic-ai/sdk` with the prompt and JSON schema from `docs/summary-prompt.json`. Reads the API key from `ANTHROPIC_API_KEY` environment variable.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { assembleContent } from "./content.js";
import type { Summarizer, SummaryResult, ThreadContent } from "./types.js";

const SYSTEM_PROMPT = "..."; // from summary-prompt.json
const USER_PROMPT_TEMPLATE = "..."; // from summary-prompt.json
const TOOL_SCHEMA = { ... }; // from summary-prompt.json json_schema

export class AnthropicSummarizer implements Summarizer {
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env["ANTHROPIC_API_KEY"],
    });
  }

  async summarize(content: ThreadContent): Promise<SummaryResult> {
    const assembled = assembleContent(content);
    const userPrompt = USER_PROMPT_TEMPLATE.replace("{content}", assembled);

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [
        {
          name: "github_issue_summary",
          description: "Structured summary of a GitHub issue/PR thread",
          input_schema: TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "github_issue_summary" },
    });

    const toolBlock = response.content.find((block) => block.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error("Summarizer: no tool_use block in response");
    }

    const result = toolBlock.input as {
      description_summary: string;
      comments: Array<{ comment_number: number; summary: string }>;
    };

    return {
      descriptionSummary: result.description_summary,
      comments: result.comments.map((c) => ({
        commentNumber: c.comment_number,
        summary: c.summary,
      })),
    };
  }
}
```

The tool schema's `input_schema` uses the `schema` object from `summary-prompt.json` (the `properties` within it), NOT the outer `json_schema` wrapper.

#### 4.1.5 Contract Stub

**File**: `src/summarizer/stub.ts`

Deterministic implementation that derives predictable output from input, for testing:

```ts
import type { Summarizer, SummaryResult, ThreadContent } from "./types.js";

/**
 * Deterministic summarizer for tests. Derives summaries from input text
 * without calling any external API.
 */
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
```

### Success Criteria

#### Automated Verification:
- [ ] `bun add @anthropic-ai/sdk` succeeds
- [ ] `bun run typecheck` passes with new files
- [ ] `bun run check` passes (formatting + linting)
- [ ] Unit tests for `assembleContent()` pass
- [ ] Unit tests for `StubSummarizer` pass (deterministic output, call tracking)

#### Manual Verification:
- [ ] None needed — no integration yet

---

## Phase 4.2: GitHub Client Extension

### Overview

Add `getIssueDetails()` to fetch the issue/PR description body, needed for assembling thread content for the summarizer.

### Changes Required

#### 4.2.1 Add Type

**File**: `src/github/types.ts`

```ts
export interface GitHubIssueDetails {
  number: number;
  title: string;
  body: string | null;
  user: {
    login: string;
  } | null;
  html_url: string;
}
```

#### 4.2.2 Extend Interface

**File**: `src/github/client.ts`

Add to `GitHubClient` interface:

```ts
getIssueDetails(owner: string, repo: string, issueNumber: number): Promise<GitHubIssueDetails>;
```

#### 4.2.3 Implement in FetchGitHubClient

**File**: `src/github/client.ts`

```ts
async getIssueDetails(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssueDetails> {
  return this.get<GitHubIssueDetails>(
    `/repos/${owner}/${repo}/issues/${String(issueNumber)}`,
  );
}
```

#### 4.2.4 Add to FixtureGitHubClient

**File**: `tests/helpers/github.ts`

Add a fixture file `tests/github/fixtures/issue-details.json` and `tests/github/fixtures/pr-details.json` with realistic data. Load them in the constructor and return from `getIssueDetails()`:

```ts
private issueDetails: Map<string, GitHubIssueDetails>;

constructor() {
  // ... existing ...
  this.issueDetails = new Map([
    ["acme/project/42", loadFixture<GitHubIssueDetails>("issue-details.json")],
    ["acme/project/99", loadFixture<GitHubIssueDetails>("pr-details.json")],
  ]);
}

async getIssueDetails(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssueDetails> {
  const key = `${owner}/${repo}/${String(issueNumber)}`;
  const details = this.issueDetails.get(key);
  if (!details) {
    throw new Error(`Fixture not found: ${key}`);
  }
  return details;
}
```

#### 4.2.5 Fixture Files

**File**: `tests/github/fixtures/issue-details.json`

```json
{
  "number": 42,
  "title": "Fix widget rendering in dark mode",
  "body": "The widget component renders incorrectly when dark mode is enabled. The background color is not applied to the inner container.\n\nSteps to reproduce:\n1. Enable dark mode\n2. Open the widget panel\n3. Observe the white background on inner elements",
  "user": { "login": "octocat" },
  "html_url": "https://github.com/acme/project/issues/42"
}
```

**File**: `tests/github/fixtures/pr-details.json`

```json
{
  "number": 99,
  "title": "Add caching layer for API responses",
  "body": "This PR adds a caching layer using an LRU cache for GitHub API responses to reduce rate limit consumption.\n\nChanges:\n- Added LRUCache class\n- Wrapped fetch calls with cache check\n- Added TTL configuration",
  "user": { "login": "developer" },
  "html_url": "https://github.com/acme/project/pull/99"
}
```

### Success Criteria

#### Automated Verification:
- [ ] `bun run typecheck` passes
- [ ] `bun run check` passes
- [ ] `bun test` passes (existing tests still green, FixtureGitHubClient satisfies updated interface)
- [ ] New test: `getIssueDetails` returns fixture data for known issue/PR

#### Manual Verification:
- [ ] None needed

---

## Phase 4.3: Database + RPC Updates

### Overview

Add `description_summary` column to the notifications table, update types and queries, and wire through RPC to the WebView.

### Changes Required

#### 4.3.1 Migration v6

**File**: `src/db/schema.ts`

Append to `MIGRATIONS` array:

```ts
{
  version: 6,
  name: "add_description_summary",
  sql: `
    ALTER TABLE notifications ADD COLUMN description_summary TEXT;
  `,
},
```

#### 4.3.2 Update Row Type

**File**: `src/db/types.ts`

Add to `NotificationRow`:

```ts
description_summary: string | null;
```

#### 4.3.3 Add Query Methods

**File**: `src/db/queries.ts`

Add two new methods to `GHDDatabase`:

```ts
updateDescriptionSummary(threadId: ThreadId, summary: string): void {
  this.db.run(
    "UPDATE notifications SET description_summary = ?2, updated_at = datetime('now') WHERE thread_id = ?1",
    [threadId, summary],
  );
}

updateEventSummary(threadId: ThreadId, eventId: EventId, summary: string): void {
  this.db.run(
    "UPDATE notification_events SET summary = ?3 WHERE notification_thread_id = ?1 AND event_id = ?2",
    [threadId, eventId, summary],
  );
}
```

Import `EventId` in the imports at the top.

#### 4.3.4 Update RPC Types

**File**: `src/shared/rpc.ts`

Add `descriptionSummary` to `NotificationWithEvents`:

```ts
export interface NotificationWithEvents {
  threadId: string;
  repository: string;
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string | null;
  reason: string;
  unread: boolean;
  githubUpdatedAt: string;
  descriptionSummary: string | null; // NEW
  events: NotificationEventData[];
}
```

#### 4.3.5 Update RPC Handler

**File**: `src/bun/index.ts`

In the `getNotifications` handler, add `descriptionSummary` to the mapping:

```ts
const result: NotificationWithEvents[] = notifications.map((n) => ({
  // ... existing fields ...
  descriptionSummary: n.description_summary, // NEW
  events: db.getNotificationEvents(threadId(n.thread_id)).map((e) => ({
    // ... existing fields ...
  })),
}));
```

### Success Criteria

#### Automated Verification:
- [ ] `bun run typecheck` passes
- [ ] `bun run check` passes
- [ ] `bun test` passes — migration tests verify v6 applies cleanly
- [ ] New tests: `updateDescriptionSummary` and `updateEventSummary` write and read back correctly

#### Manual Verification:
- [ ] None needed

---

## Phase 4.4: Poller Integration

### Overview

Wire the summarizer into the notification poller. After fetching timeline events, assemble thread content, call the summarizer asynchronously, and store results.

### Changes Required

#### 4.4.1 Update NotificationPoller Constructor

**File**: `src/poller/notifications.ts`

Add optional `Summarizer` dependency:

```ts
import type { Summarizer } from "../summarizer/types.js";

export interface NotificationPollerOptions {
  intervalMs?: number;
  onSync?: () => void;
  summarizer?: Summarizer; // NEW
}

export class NotificationPoller {
  // ... existing fields ...
  private readonly summarizer: Summarizer | undefined; // NEW

  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    options?: NotificationPollerOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.onSync = options?.onSync;
    this.summarizer = options?.summarizer; // NEW
  }
```

#### 4.4.2 Add Summarization to fetchAndStoreTimeline

**File**: `src/poller/notifications.ts`

After storing timeline events, kick off async summarization. The method returns the list of stored comment events (those with bodies) so summarization can map results back:

```ts
private async fetchAndStoreTimeline(
  tid: ThreadId,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  const events = await this.github.getTimelineEvents(owner, repo, issueNumber);

  // Track comment events in order for summary mapping
  const commentEvents: Array<{ eventId: EventId; body: string }> = [];

  for (const event of events) {
    const mappedType = mapEventType(event.event);
    if (!mappedType) continue;

    const eid = eventId(extractEventId(event));
    const body = event.body ?? null;

    this.db.upsertNotificationEvent({
      notificationThreadId: tid,
      eventId: eid,
      eventType: mappedType,
      actor: extractActor(event),
      body,
      summary: null, // Filled by async summarization below
      url: event.html_url ?? null,
      eventTimestamp: extractTimestamp(event),
    });

    if (mappedType === "comment" && body) {
      commentEvents.push({ eventId: eid, body });
    }
  }

  // Fire-and-forget async summarization
  if (this.summarizer) {
    void this.summarizeThread(tid, owner, repo, issueNumber, commentEvents);
  }
}
```

#### 4.4.3 New summarizeThread Method

**File**: `src/poller/notifications.ts`

```ts
private async summarizeThread(
  tid: ThreadId,
  owner: string,
  repo: string,
  issueNumber: number,
  commentEvents: Array<{ eventId: EventId; body: string }>,
): Promise<void> {
  try {
    const issueDetails = await this.github.getIssueDetails(owner, repo, issueNumber);

    const content = {
      description: issueDetails.body ?? "",
      comments: commentEvents.map((c, i) => ({
        number: i + 1,
        body: c.body,
      })),
    };

    const result = await this.summarizer!.summarize(content);

    // Store description summary
    this.db.updateDescriptionSummary(tid, result.descriptionSummary);

    // Store per-comment summaries
    for (const commentSummary of result.comments) {
      const idx = commentSummary.commentNumber - 1;
      const event = commentEvents[idx];
      if (event) {
        this.db.updateEventSummary(tid, event.eventId, commentSummary.summary);
      }
    }

    // Notify UI that summaries are available
    this.onSync?.();
  } catch (err) {
    console.error(`[ghd] Summarization failed for thread ${tid}:`, err);
    // Non-fatal: summaries remain null, notification still works
  }
}
```

#### 4.4.4 Wire Summarizer in Main Process

**File**: `src/bun/index.ts`

```ts
import { AnthropicSummarizer } from "../summarizer/anthropic.js";

// In the async IIFE, after creating github client:
const summarizer = process.env["ANTHROPIC_API_KEY"]
  ? new AnthropicSummarizer()
  : undefined;

if (!summarizer) {
  console.log("[ghd] No ANTHROPIC_API_KEY set, summaries disabled");
}

const notificationPoller = new NotificationPoller(db, github, {
  summarizer, // NEW
  onSync: () => {
    win.webview.rpc?.send("stateUpdated", { scope: "notifications" });
  },
});
```

#### 4.4.5 Update Poller Tests

**File**: `tests/poller/notifications.test.ts`

Update `setup()` to optionally accept a summarizer, and add new tests:

```ts
import { StubSummarizer } from "../../src/summarizer/stub.js";

function setup(options?: { summarizer?: Summarizer }) {
  const rawDb = createMemoryDatabase();
  const db = new GHDDatabase(rawDb);
  const github = new FixtureGitHubClient();
  const poller = new NotificationPoller(db, github, {
    summarizer: options?.summarizer,
  });
  return { db, github, poller };
}
```

New tests:

- `poll() with summarizer populates description_summary on notifications`
- `poll() with summarizer populates event summaries on comment events`
- `poll() without summarizer leaves summaries as null` (existing behavior, verify)
- `poll() with failing summarizer still stores notifications and events`

### Success Criteria

#### Automated Verification:
- [ ] `bun run typecheck` passes
- [ ] `bun run check` passes
- [ ] `bun test` passes — existing tests green + new summarizer tests pass
- [ ] StubSummarizer records calls correctly and produces deterministic output

#### Manual Verification:
- [ ] With `ANTHROPIC_API_KEY` set, `bun run dev` shows real summaries appearing on notifications after poll
- [ ] Without `ANTHROPIC_API_KEY`, app starts normally and logs "summaries disabled"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4.5: UI Polish

### Overview

Display description summaries in notification headers and adjust summary styling to use a toned-down color.

### Changes Required

#### 4.5.1 Render Description Summary in Header

**File**: `src/mainview/index.ts`

In `renderNotificationBlock()`, add a description summary line after the header:

```ts
function renderNotificationBlock(notif: NotificationWithEvents): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "notification-block";
  if (notif.unread) block.classList.add("unread");
  block.dataset["threadId"] = notif.threadId;

  const header = document.createElement("div");
  header.className = "notification-header";
  header.innerHTML = `
    <span class="notification-icon">${subjectTypeIcon(notif.subjectType)}</span>
    <span class="notification-title">${escapeHtml(notif.subjectTitle)}</span>
    <span class="notification-repo">${escapeHtml(notif.repository)}</span>
    <span class="notification-time">${relativeTime(notif.githubUpdatedAt)}</span>
  `;
  block.appendChild(header);

  // NEW: Description summary below header
  if (notif.descriptionSummary) {
    const summaryLine = document.createElement("div");
    summaryLine.className = "notification-summary";
    summaryLine.innerHTML = `✨ ${escapeHtml(notif.descriptionSummary)}`;
    block.appendChild(summaryLine);
  }

  if (notif.events.length > 0) {
    block.appendChild(renderEventTree(notif.events));
  }

  return block;
}
```

#### 4.5.2 Update CSS

**File**: `src/mainview/index.css`

Add style for description summary and tone down event summary color:

```css
.notification-summary {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  padding-left: 28px;
  margin-top: 2px;
}

.event-summary {
  font-size: 12px;
  color: var(--text-muted); /* Changed from var(--text) */
  font-style: italic;
}
```

### Success Criteria

#### Automated Verification:
- [ ] `bun run typecheck` passes
- [ ] `bun run check` passes
- [ ] `bun test` passes

#### Manual Verification:
- [ ] Description summaries appear below notification headers with sparkle emoji, muted italic text
- [ ] Event summaries appear inline on comment event lines with sparkle emoji, muted italic text
- [ ] Notifications without summaries render normally (no empty space or broken layout)
- [ ] The muted color is clearly distinguishable from regular text but not too faint

---

## Testing Strategy

### Unit Tests

- `assembleContent()` — correct formatting with description only, description + comments, empty description
- `StubSummarizer` — deterministic output, call tracking, handles empty content
- `AnthropicSummarizer` — NOT unit tested (would require API calls); tested via integration with stub

### Integration Tests

- **Database**: migration v6 applies cleanly, `updateDescriptionSummary` and `updateEventSummary` read/write correctly
- **Poller + StubSummarizer**: full poll cycle stores summaries on both notification and event rows
- **Poller without summarizer**: existing behavior unchanged, summaries remain null
- **Poller with failing summarizer**: notifications and events still stored, summaries remain null

### Manual Testing Steps

1. Set `ANTHROPIC_API_KEY` env var and run `bun run dev`
2. Wait for first poll cycle (or trigger manually)
3. Verify description summaries appear below notification titles
4. Verify comment event summaries appear inline on event lines
5. Unset `ANTHROPIC_API_KEY`, restart — verify app works without summaries
6. Check console for "summaries disabled" log message

## Performance Considerations

- Summarization is async and fire-and-forget — poll loop is not blocked
- Each notification thread triggers one Anthropic API call (description + all comments in one request)
- Claude Haiku is fast and cheap; typical response under 1 second
- No batching needed at current scale (notifications poll every 15 minutes)
- If a thread has no comments and no description body, summarization is skipped

## References

- Design document: `docs/design.md` (Phase 4, lines 166-167)
- Summary prompt: `docs/summary-prompt.json`
- Previous phases: `docs/plans/2026-03-10-phase-{1,2,3}-*.md`
