# Phase 2 — Data Pipeline: Implementation Plan

## Overview

Build the data pipeline that polls GitHub for notifications and user activity, enriches notifications with timeline events, and persists everything to SQLite through a typed query interface. The GitHub client auto-discovers the auth token from the `gh` CLI, falling back to an environment variable. Pollers start automatically on app launch. LLM summaries are left as `null` (Phase 4).

## Current State Analysis

Phase 1 delivered:
- SQLite schema with all 5 tables (`notifications`, `notification_events`, `pinned`, `activity`, `sync_meta`)
- Migration runner, branded ID types, row interfaces
- Raw `bun:sqlite` `Database` instance — **no typed query abstraction yet**
- Tests use `db.query<T, P>()` / `db.run()` directly
- Main process creates DB and opens window, nothing else

### Key Discoveries:
- `createDatabase()` returns raw `Database` — all consumers call SQL directly (`src/db/client.ts:14`)
- Branded types exist (`ThreadId`, `EventId`, `PinId`, `ActivityId`) but aren't used yet — tests use raw strings (`src/db/types.ts:1-23`)
- `sync_meta` table is ready for tracking poll timestamps (`src/db/schema.ts`, migration 5)
- `gh auth token` works on this machine and has `notifications` scope — returns an OAuth token
- GitHub username is `albertclerigues` (needed for the Events API)

## Desired End State

1. The app polls GitHub notifications every 15 minutes and user activity every 15 minutes on launch.
2. Notifications are stored with their full timeline events (comments, reviews, merges, etc.).
3. Activity events are normalized to the action vocabulary (committed, commented, opened, closed, merged, reviewed).
4. All data is persisted through a typed `GHDDatabase` class with methods like `upsertNotification`, `getNotifications`, `upsertActivity`, etc.
5. The `gh` CLI token is used automatically; `GHD_GITHUB_TOKEN` env var is the fallback.
6. Rate-limit headers are respected with backoff when quota is low.
7. Pollers use `sync_meta` to track the last poll timestamp for incremental fetches.
8. All new code is covered by unit and integration tests, including a fixture-based GitHub client.

### Verification:
```bash
bun run check        # biome format + lint
bun run typecheck    # tsc --noEmit (filtered)
bun test             # all tests pass (unit + integration)
bun run dev          # launches app, polls GitHub, populates DB
sqlite3 ~/.ghd/ghd.sqlite "SELECT COUNT(*) FROM notifications"  # > 0
sqlite3 ~/.ghd/ghd.sqlite "SELECT COUNT(*) FROM activity"       # > 0
```

## What We're NOT Doing

- No LLM summarization — `summary` column stays `null` (Phase 4)
- No RPC wiring to the WebView — data exists in DB but the UI still shows placeholders (Phase 3)
- No IPC server or CLI (Phase 6)
- No marking threads as read on GitHub — read-only polling only
- No pinned items management — that requires user interaction (Phase 3+)
- No error handling UI or config UI (Phase 7)
- No retry/queue for failed timeline fetches — just log and skip

## Implementation Approach

Build bottom-up: database query interface first (everything depends on it), then the GitHub client, then the pollers that connect the two. Tests at each layer use real infrastructure (in-memory SQLite, fixture-based HTTP client).

### New file structure:
```
src/
├── db/
│   ├── client.ts          — (existing) factory functions
│   ├── queries.ts          — NEW: GHDDatabase class with typed methods
│   ├── migrations.ts      — (existing)
│   ├── schema.ts          — (existing)
│   └── types.ts           — (existing, extended with new domain types)
├── github/
│   ├── client.ts          — NEW: GitHubClient interface + fetch implementation
│   ├── types.ts           — NEW: GitHub API response types
│   └── token.ts           — NEW: Token resolution (gh CLI → env var)
├── poller/
│   ├── notifications.ts   — NEW: NotificationPoller
│   └── activity.ts        — NEW: ActivityPoller
└── bun/
    └── index.ts           — (modified) starts pollers on launch
tests/
├── db/
│   ├── migrations.test.ts — (existing)
│   ├── queries.test.ts    — (existing, extended)
│   └── ghd-database.test.ts — NEW: GHDDatabase integration tests
├── github/
│   ├── client.test.ts     — NEW: GitHub client unit tests
│   ├── token.test.ts      — NEW: Token resolution tests
│   └── fixtures/          — NEW: Recorded API responses
│       ├── notifications.json
│       ├── timeline-issue.json
│       ├── timeline-pr.json
│       └── user-events.json
├── poller/
│   ├── notifications.test.ts — NEW: Notification poller integration tests
│   └── activity.test.ts      — NEW: Activity poller integration tests
└── helpers/
    ├── db.ts              — (existing)
    └── github.ts          — NEW: FixtureGitHubClient
```

---

## Phase 2.1 — Database Query Interface (`GHDDatabase`)

### Overview
Wrap the raw `Database` instance in a typed class that encapsulates all SQL queries behind domain methods. This is the foundation that pollers, the future RPC layer, and the CLI will all depend on.

### Changes Required:

#### 2.1.1 Extended Domain Types

**File**: `src/db/types.ts`
**Changes**: Add discriminated union for notification event types. Add input types for upsert operations (separate from row types, which represent what comes out of the DB).

```typescript
// --- Add after existing branded types and row interfaces ---

// Event type discriminated union for type-safe event handling
export type NotificationEventType =
  | "comment"
  | "review"
  | "review_request"
  | "merge"
  | "close"
  | "reopen"
  | "label"
  | "assignment"
  | "rename"
  | "reference"
  | "commit";

// Input types for upsert operations (what goes INTO the DB)
export interface UpsertNotificationInput {
  threadId: ThreadId;
  repository: string;
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string | null;
  reason: string;
  unread: boolean;
  githubUpdatedAt: string;
  githubLastReadAt: string | null;
}

export interface UpsertNotificationEventInput {
  notificationThreadId: ThreadId;
  eventId: EventId;
  eventType: NotificationEventType;
  actor: string;
  body: string | null;
  summary: string | null;
  url: string | null;
  eventTimestamp: string;
}

export interface UpsertActivityInput {
  eventId: ActivityId;
  eventType: string;
  repository: string;
  action: string;
  targetTitle: string;
  targetUrl: string | null;
  eventTimestamp: string;
}

// Action vocabulary for normalized activity events
export type ActivityAction =
  | "committed"
  | "commented"
  | "opened"
  | "closed"
  | "merged"
  | "reviewed"
  | "created"
  | "deleted"
  | "forked"
  | "starred"
  | "released";
```

#### 2.1.2 GHDDatabase Class

**File**: `src/db/queries.ts` (NEW)
**Changes**: Typed query interface wrapping the raw `Database`.

```typescript
import type { Database } from "bun:sqlite";
import type {
  ActivityRow,
  NotificationEventRow,
  NotificationRow,
  PinnedRow,
  SyncMetaRow,
  ThreadId,
  UpsertActivityInput,
  UpsertNotificationEventInput,
  UpsertNotificationInput,
} from "./types.js";

export class GHDDatabase {
  constructor(private readonly db: Database) {}

  // --- Notifications ---

  upsertNotification(input: UpsertNotificationInput): void {
    this.db.run(
      `INSERT INTO notifications (
        thread_id, repository, subject_type, subject_title, subject_url,
        reason, unread, github_updated_at, github_last_read_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
      ON CONFLICT(thread_id) DO UPDATE SET
        repository = excluded.repository,
        subject_type = excluded.subject_type,
        subject_title = excluded.subject_title,
        subject_url = excluded.subject_url,
        reason = excluded.reason,
        unread = excluded.unread,
        github_updated_at = excluded.github_updated_at,
        github_last_read_at = excluded.github_last_read_at,
        updated_at = datetime('now')`,
      [
        input.threadId,
        input.repository,
        input.subjectType,
        input.subjectTitle,
        input.subjectUrl,
        input.reason,
        input.unread ? 1 : 0,
        input.githubUpdatedAt,
        input.githubLastReadAt,
      ],
    );
  }

  getNotifications(options?: {
    unreadOnly?: boolean;
    includeDismissed?: boolean;
  }): NotificationRow[] {
    const conditions: string[] = [];
    if (options?.unreadOnly) {
      conditions.push("unread = 1");
    }
    if (!options?.includeDismissed) {
      conditions.push("dismissed_at IS NULL");
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .query<NotificationRow, []>(
        `SELECT * FROM notifications ${where} ORDER BY github_updated_at DESC`,
      )
      .all();
  }

  getNotificationByThreadId(threadId: ThreadId): NotificationRow | null {
    return (
      this.db
        .query<NotificationRow, [string]>("SELECT * FROM notifications WHERE thread_id = ?1")
        .get(threadId) ?? null
    );
  }

  dismissNotification(threadId: ThreadId): void {
    this.db.run(
      "UPDATE notifications SET dismissed_at = datetime('now'), updated_at = datetime('now') WHERE thread_id = ?1",
      [threadId],
    );
  }

  // --- Notification Events ---

  upsertNotificationEvent(input: UpsertNotificationEventInput): void {
    this.db.run(
      `INSERT INTO notification_events (
        notification_thread_id, event_id, event_type, actor, body, summary, url, event_timestamp
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(notification_thread_id, event_id) DO UPDATE SET
        event_type = excluded.event_type,
        actor = excluded.actor,
        body = excluded.body,
        summary = excluded.summary,
        url = excluded.url,
        event_timestamp = excluded.event_timestamp`,
      [
        input.notificationThreadId,
        input.eventId,
        input.eventType,
        input.actor,
        input.body,
        input.summary,
        input.url,
        input.eventTimestamp,
      ],
    );
  }

  getNotificationEvents(threadId: ThreadId): NotificationEventRow[] {
    return this.db
      .query<NotificationEventRow, [string]>(
        "SELECT * FROM notification_events WHERE notification_thread_id = ?1 ORDER BY event_timestamp ASC",
      )
      .all(threadId);
  }

  // --- Activity ---

  upsertActivity(input: UpsertActivityInput): void {
    this.db.run(
      `INSERT INTO activity (
        event_id, event_type, repository, action, target_title, target_url, event_timestamp
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(event_id) DO NOTHING`,
      [
        input.eventId,
        input.eventType,
        input.repository,
        input.action,
        input.targetTitle,
        input.targetUrl,
        input.eventTimestamp,
      ],
    );
  }

  getActivity(options?: { limit?: number }): ActivityRow[] {
    const limit = options?.limit ?? 100;
    return this.db
      .query<ActivityRow, [number]>(
        "SELECT * FROM activity ORDER BY event_timestamp DESC LIMIT ?1",
      )
      .all(limit);
  }

  pruneActivity(daysToKeep: number): number {
    const result = this.db.run(
      "DELETE FROM activity WHERE event_timestamp < datetime('now', ?1)",
      [`-${String(daysToKeep)} days`],
    );
    return result.changes;
  }

  // --- Pinned (read-only for now, full CRUD in Phase 3) ---

  getPinnedGrouped(): Map<string, PinnedRow[]> {
    const rows = this.db
      .query<PinnedRow, []>("SELECT * FROM pinned ORDER BY group_name, sort_order")
      .all();
    const groups = new Map<string, PinnedRow[]>();
    for (const row of rows) {
      const existing = groups.get(row.group_name);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(row.group_name, [row]);
      }
    }
    return groups;
  }

  // --- Sync Meta ---

  getSyncMeta(key: string): string | null {
    const row = this.db
      .query<SyncMetaRow, [string]>("SELECT * FROM sync_meta WHERE key = ?1")
      .get(key);
    return row?.value ?? null;
  }

  setSyncMeta(key: string, value: string): void {
    this.db.run(
      `INSERT INTO sync_meta (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, value],
    );
  }

  // --- Raw query (for CLI `query` subcommand in Phase 6) ---

  rawQuery(sql: string): unknown[] {
    return this.db.query(sql).all();
  }

  close(): void {
    this.db.close();
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run typecheck` passes
- [x] `bun run check` passes
- [x] `bun test` passes — new `tests/db/ghd-database.test.ts` covers all methods

**Implementation Note**: Pause after this phase to verify all DB tests pass before building the GitHub client.

---

## Phase 2.2 — GitHub Token Resolution

### Overview
Resolve the GitHub auth token by trying `gh auth token` first, then falling back to `GHD_GITHUB_TOKEN` env var. This is a small, testable module.

### Changes Required:

#### 2.2.1 Token Resolution

**File**: `src/github/token.ts` (NEW)

```typescript
export class GitHubTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubTokenError";
  }
}

/**
 * Resolves a GitHub auth token using the following priority:
 * 1. GHD_GITHUB_TOKEN environment variable
 * 2. `gh auth token` CLI command (requires gh CLI installed and authenticated)
 *
 * Throws GitHubTokenError if no token can be found.
 */
export async function resolveGitHubToken(): Promise<string> {
  // 1. Check environment variable first (explicit config takes priority)
  const envToken = process.env["GHD_GITHUB_TOKEN"];
  if (envToken) {
    return envToken;
  }

  // 2. Try gh CLI
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const token = output.trim();
      if (token.length > 0) {
        return token;
      }
    }
  } catch {
    // gh CLI not installed or not in PATH — fall through
  }

  throw new GitHubTokenError(
    "No GitHub token found. Either set GHD_GITHUB_TOKEN or run `gh auth login`.",
  );
}
```

#### 2.2.2 Username Resolution

The GitHub Events API requires the authenticated username. We resolve it once at startup.

**File**: `src/github/token.ts` (append to the same file)

```typescript
/**
 * Resolves the authenticated GitHub username.
 * Called once at startup; the result is cached by the caller.
 */
export async function resolveGitHubUsername(token: string): Promise<string> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new GitHubTokenError(
      `Failed to resolve GitHub username: ${String(response.status)} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as { login: string };
  return data.login;
}
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run typecheck` passes
- [x] `bun run check` passes
- [x] `bun test` passes — `tests/github/token.test.ts` covers env var path and error case (gh CLI path tested only if gh is available)

---

## Phase 2.3 — GitHub REST Client

### Overview
Thin fetch wrapper that authenticates with the resolved token and exposes methods for the three API endpoint families. Handles pagination via `Link` headers and respects rate-limit headers.

### Changes Required:

#### 2.3.1 GitHub API Response Types

**File**: `src/github/types.ts` (NEW)

Types modeled after the GitHub REST API responses we actually consume. Only the fields we use are typed — the rest is ignored.

```typescript
// --- Notification Thread (GET /notifications) ---
export interface GitHubNotificationThread {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  last_read_at: string | null;
  subject: {
    title: string;
    url: string | null; // API URL, e.g. https://api.github.com/repos/.../issues/1
    type: string; // "Issue", "PullRequest", "Discussion", "Release", etc.
  };
  repository: {
    full_name: string; // "owner/repo"
    html_url: string;
  };
}

// --- Timeline Event (GET /repos/{owner}/{repo}/issues/{number}/timeline) ---
export interface GitHubTimelineEvent {
  id?: number;
  node_id?: string;
  event: string; // "commented", "reviewed", "merged", "closed", "renamed", etc.
  actor?: {
    login: string;
  } | null;
  user?: {
    login: string;
  } | null;
  body?: string | null;
  html_url?: string | null;
  created_at?: string;
  submitted_at?: string; // used by review events
}

// --- User Event (GET /users/{username}/events) ---
export interface GitHubUserEvent {
  id: string;
  type: string; // "PushEvent", "IssueCommentEvent", "PullRequestEvent", etc.
  repo: {
    name: string; // "owner/repo"
  };
  payload: {
    action?: string; // "opened", "closed", "created", etc.
    pull_request?: { title: string; html_url: string; merged?: boolean };
    issue?: { title: string; html_url: string };
    comment?: { html_url: string };
    commits?: Array<{ message: string }>;
    ref?: string;
    ref_type?: string;
    release?: { tag_name: string; html_url: string };
    forkee?: { full_name: string; html_url: string };
  };
  created_at: string;
}

// --- Rate Limit Info ---
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: number; // Unix timestamp
}
```

#### 2.3.2 GitHub Client Interface and Implementation

**File**: `src/github/client.ts` (NEW)

```typescript
import type {
  GitHubNotificationThread,
  GitHubTimelineEvent,
  GitHubUserEvent,
  RateLimitInfo,
} from "./types.js";

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const LOW_RATE_LIMIT_THRESHOLD = 100;

// --- Interface (for fixture-based testing) ---

export interface GitHubClient {
  listNotifications(options?: {
    since?: string;
    all?: boolean;
  }): Promise<GitHubNotificationThread[]>;

  getTimelineEvents(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubTimelineEvent[]>;

  listUserEvents(username: string): Promise<GitHubUserEvent[]>;

  markThreadAsRead(threadId: string): Promise<void>;

  getRateLimit(): RateLimitInfo | null;
}

// --- Fetch-based implementation ---

export class FetchGitHubClient implements GitHubClient {
  private lastRateLimit: RateLimitInfo | null = null;

  constructor(private readonly token: string) {}

  async listNotifications(options?: {
    since?: string;
    all?: boolean;
  }): Promise<GitHubNotificationThread[]> {
    const params = new URLSearchParams();
    if (options?.since) {
      params.set("since", options.since);
    }
    if (options?.all) {
      params.set("all", "true");
    }
    params.set("per_page", "50");

    return this.paginatedGet<GitHubNotificationThread>(
      `/notifications?${params.toString()}`,
    );
  }

  async getTimelineEvents(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubTimelineEvent[]> {
    return this.paginatedGet<GitHubTimelineEvent>(
      `/repos/${owner}/${repo}/issues/${String(issueNumber)}/timeline`,
    );
  }

  async listUserEvents(username: string): Promise<GitHubUserEvent[]> {
    // Events API doesn't support pagination beyond 10 pages / 300 events
    // and doesn't support `since`. We fetch the first page (30 events).
    return this.get<GitHubUserEvent[]>(
      `/users/${username}/events?per_page=30`,
    );
  }

  async markThreadAsRead(threadId: string): Promise<void> {
    await this.request(`/notifications/threads/${threadId}`, {
      method: "PATCH",
    });
  }

  getRateLimit(): RateLimitInfo | null {
    return this.lastRateLimit;
  }

  // --- Private helpers ---

  private async request(path: string, init?: RequestInit): Promise<Response> {
    await this.waitForRateLimit();

    const url = path.startsWith("https://") ? path : `${GITHUB_API_BASE}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        ...init?.headers,
      },
    });

    this.updateRateLimit(response);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub API error: ${String(response.status)} ${response.statusText} — ${body}`,
      );
    }

    return response;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return response.json() as Promise<T>;
  }

  private async paginatedGet<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = path;

    while (nextUrl) {
      const response = await this.request(nextUrl);
      const page = (await response.json()) as T[];
      results.push(...page);
      nextUrl = this.parseNextLink(response.headers.get("Link"));
    }

    return results;
  }

  private parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
    return match?.[1] ?? null;
  }

  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const limit = response.headers.get("X-RateLimit-Limit");
    const reset = response.headers.get("X-RateLimit-Reset");
    if (remaining && limit && reset) {
      this.lastRateLimit = {
        remaining: Number.parseInt(remaining, 10),
        limit: Number.parseInt(limit, 10),
        reset: Number.parseInt(reset, 10),
      };
    }
  }

  private async waitForRateLimit(): Promise<void> {
    if (!this.lastRateLimit) return;
    if (this.lastRateLimit.remaining > LOW_RATE_LIMIT_THRESHOLD) return;

    const now = Math.floor(Date.now() / 1000);
    const waitSeconds = this.lastRateLimit.reset - now;
    if (waitSeconds > 0 && waitSeconds < 300) {
      // Wait up to 5 minutes for rate limit reset
      console.log(
        `[ghd] Rate limit low (${String(this.lastRateLimit.remaining)} remaining), waiting ${String(waitSeconds)}s for reset`,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, waitSeconds * 1000);
      });
    }
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run typecheck` passes
- [x] `bun run check` passes
- [x] `bun test` passes — `tests/github/client.test.ts` tests pagination parsing, rate-limit header parsing, and URL construction

---

## Phase 2.4 — Fixture-Based GitHub Client

### Overview
Create a complete alternate implementation of `GitHubClient` that returns recorded API responses from JSON fixture files. This is NOT a mock — it implements the full interface, type-checked with `satisfies`. Used by poller tests.

### Changes Required:

#### 2.4.1 Fixture JSON Files

Create fixture files based on real GitHub API response shapes. These are static JSON files that the `FixtureGitHubClient` reads.

**File**: `tests/github/fixtures/notifications.json`

```json
[
  {
    "id": "1234567890",
    "unread": true,
    "reason": "mention",
    "updated_at": "2026-03-10T09:00:00Z",
    "last_read_at": null,
    "subject": {
      "title": "Fix memory leak in notification poller",
      "url": "https://api.github.com/repos/acme/project/issues/42",
      "type": "Issue"
    },
    "repository": {
      "full_name": "acme/project",
      "html_url": "https://github.com/acme/project"
    }
  },
  {
    "id": "1234567891",
    "unread": true,
    "reason": "review_requested",
    "updated_at": "2026-03-10T08:30:00Z",
    "last_read_at": "2026-03-09T12:00:00Z",
    "subject": {
      "title": "Add dark mode support",
      "url": "https://api.github.com/repos/acme/project/pulls/99",
      "type": "PullRequest"
    },
    "repository": {
      "full_name": "acme/project",
      "html_url": "https://github.com/acme/project"
    }
  }
]
```

**File**: `tests/github/fixtures/timeline-issue.json`

```json
[
  {
    "id": 100001,
    "event": "commented",
    "actor": { "login": "alice" },
    "body": "I've identified the root cause — the timer handle isn't being cleaned up on window close.",
    "html_url": "https://github.com/acme/project/issues/42#issuecomment-100001",
    "created_at": "2026-03-10T08:00:00Z"
  },
  {
    "id": 100002,
    "event": "labeled",
    "actor": { "login": "bob" },
    "body": null,
    "html_url": null,
    "created_at": "2026-03-10T08:15:00Z"
  },
  {
    "id": 100003,
    "event": "commented",
    "actor": { "login": "bob" },
    "body": "Assigned to P1, this needs to go out in the next patch release.",
    "html_url": "https://github.com/acme/project/issues/42#issuecomment-100003",
    "created_at": "2026-03-10T09:00:00Z"
  }
]
```

**File**: `tests/github/fixtures/timeline-pr.json`

```json
[
  {
    "id": 200001,
    "event": "committed",
    "actor": null,
    "body": null,
    "html_url": "https://github.com/acme/project/pull/99/commits/abc123",
    "created_at": "2026-03-10T07:00:00Z"
  },
  {
    "id": 200002,
    "event": "reviewed",
    "user": { "login": "carol" },
    "body": "Looks good overall, one small nit.",
    "html_url": "https://github.com/acme/project/pull/99#pullrequestreview-200002",
    "submitted_at": "2026-03-10T08:00:00Z"
  },
  {
    "id": 200003,
    "event": "review_requested",
    "actor": { "login": "dave" },
    "body": null,
    "html_url": null,
    "created_at": "2026-03-10T08:30:00Z"
  }
]
```

**File**: `tests/github/fixtures/user-events.json`

```json
[
  {
    "id": "30000001",
    "type": "PushEvent",
    "repo": { "name": "acme/project" },
    "payload": {
      "commits": [{ "message": "Fix memory leak in poller" }]
    },
    "created_at": "2026-03-10T09:30:00Z"
  },
  {
    "id": "30000002",
    "type": "IssueCommentEvent",
    "repo": { "name": "acme/project" },
    "payload": {
      "action": "created",
      "issue": { "title": "Fix memory leak in notification poller", "html_url": "https://github.com/acme/project/issues/42" },
      "comment": { "html_url": "https://github.com/acme/project/issues/42#issuecomment-100001" }
    },
    "created_at": "2026-03-10T08:00:00Z"
  },
  {
    "id": "30000003",
    "type": "PullRequestEvent",
    "repo": { "name": "acme/project" },
    "payload": {
      "action": "opened",
      "pull_request": { "title": "Add dark mode support", "html_url": "https://github.com/acme/project/pull/99" }
    },
    "created_at": "2026-03-10T07:30:00Z"
  },
  {
    "id": "30000004",
    "type": "PullRequestReviewEvent",
    "repo": { "name": "acme/project" },
    "payload": {
      "action": "submitted",
      "pull_request": { "title": "Add dark mode support", "html_url": "https://github.com/acme/project/pull/99" }
    },
    "created_at": "2026-03-10T08:00:00Z"
  },
  {
    "id": "30000005",
    "type": "CreateEvent",
    "repo": { "name": "acme/other-repo" },
    "payload": {
      "ref": "feature/new-api",
      "ref_type": "branch"
    },
    "created_at": "2026-03-10T06:00:00Z"
  }
]
```

#### 2.4.2 Fixture GitHub Client

**File**: `tests/helpers/github.ts` (NEW)

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitHubClient } from "../../src/github/client.js";
import type {
  GitHubNotificationThread,
  GitHubTimelineEvent,
  GitHubUserEvent,
  RateLimitInfo,
} from "../../src/github/types.js";

const FIXTURES_DIR = join(import.meta.dir, "../github/fixtures");

function loadFixture<T>(name: string): T {
  const content = readFileSync(join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(content) as T;
}

/**
 * A complete alternate implementation of GitHubClient that returns
 * recorded API responses from JSON fixture files.
 *
 * This is NOT a mock — it implements the full interface, and the
 * `satisfies` assertion at the bottom ensures compile-time conformance.
 */
export class FixtureGitHubClient implements GitHubClient {
  private notifications: GitHubNotificationThread[];
  private timelines: Map<string, GitHubTimelineEvent[]>;
  private userEvents: GitHubUserEvent[];
  private markedAsRead: Set<string> = new Set();

  constructor() {
    this.notifications = loadFixture<GitHubNotificationThread[]>("notifications.json");
    this.timelines = new Map([
      ["acme/project/42", loadFixture<GitHubTimelineEvent[]>("timeline-issue.json")],
      ["acme/project/99", loadFixture<GitHubTimelineEvent[]>("timeline-pr.json")],
    ]);
    this.userEvents = loadFixture<GitHubUserEvent[]>("user-events.json");
  }

  async listNotifications(options?: {
    since?: string;
    all?: boolean;
  }): Promise<GitHubNotificationThread[]> {
    let result = this.notifications;
    if (options?.since) {
      const sinceDate = new Date(options.since);
      result = result.filter((n) => new Date(n.updated_at) > sinceDate);
    }
    return result;
  }

  async getTimelineEvents(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubTimelineEvent[]> {
    const key = `${owner}/${repo}/${String(issueNumber)}`;
    return this.timelines.get(key) ?? [];
  }

  async listUserEvents(_username: string): Promise<GitHubUserEvent[]> {
    return this.userEvents;
  }

  async markThreadAsRead(threadId: string): Promise<void> {
    this.markedAsRead.add(threadId);
  }

  getRateLimit(): RateLimitInfo | null {
    return { remaining: 4999, limit: 5000, reset: Math.floor(Date.now() / 1000) + 3600 };
  }

  // Test helpers
  getMarkedAsRead(): Set<string> {
    return this.markedAsRead;
  }
}

// Compile-time conformance check
const _check: GitHubClient = new FixtureGitHubClient();
void _check;
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run typecheck` passes — fixture client passes `satisfies` check
- [x] `bun run check` passes
- [x] Fixture JSON files parse correctly

---

## Phase 2.5 — Notification Poller

### Overview
Timer-driven loop that fetches notifications incrementally, resolves subject URLs to browser links, fetches timeline events for each thread, and persists everything through `GHDDatabase`. Tracks last poll time in `sync_meta`.

### Changes Required:

#### 2.5.1 URL Resolution Helpers

The GitHub notification `subject.url` is an API URL (e.g., `https://api.github.com/repos/acme/project/issues/42`). We need to convert it to a browser URL and extract the issue/PR number.

**File**: `src/github/urls.ts` (NEW)

```typescript
/**
 * Converts a GitHub API URL to a browser-facing HTML URL.
 * e.g., "https://api.github.com/repos/acme/project/issues/42"
 *     → "https://github.com/acme/project/issues/42"
 */
export function apiUrlToHtmlUrl(apiUrl: string): string {
  return apiUrl.replace("https://api.github.com/repos/", "https://github.com/");
}

/**
 * Extracts owner, repo, and issue/PR number from a GitHub API subject URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function parseSubjectUrl(
  apiUrl: string,
): { owner: string; repo: string; number: number } | null {
  // Matches: https://api.github.com/repos/{owner}/{repo}/issues/{number}
  // Also:    https://api.github.com/repos/{owner}/{repo}/pulls/{number}
  const match = /\/repos\/([^/]+)\/([^/]+)\/(?:issues|pulls)\/(\d+)$/.exec(apiUrl);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}
```

#### 2.5.2 Timeline Event Mapping

Map GitHub timeline events to our `NotificationEventType` vocabulary.

**File**: `src/github/events.ts` (NEW)

```typescript
import type { NotificationEventType } from "../db/types.js";
import type { GitHubTimelineEvent } from "./types.js";

const EVENT_TYPE_MAP: Record<string, NotificationEventType> = {
  commented: "comment",
  reviewed: "review",
  review_requested: "review_request",
  merged: "merge",
  closed: "close",
  reopened: "reopen",
  labeled: "label",
  unlabeled: "label",
  assigned: "assignment",
  unassigned: "assignment",
  renamed: "rename",
  referenced: "reference",
  committed: "commit",
};

export function mapEventType(githubEvent: string): NotificationEventType | null {
  return EVENT_TYPE_MAP[githubEvent] ?? null;
}

export function extractActor(event: GitHubTimelineEvent): string {
  return event.actor?.login ?? event.user?.login ?? "unknown";
}

export function extractTimestamp(event: GitHubTimelineEvent): string {
  // Review events use submitted_at, everything else uses created_at
  return event.submitted_at ?? event.created_at ?? new Date().toISOString();
}

export function extractEventId(event: GitHubTimelineEvent): string {
  // Use node_id first (guaranteed unique), fall back to numeric id
  if (event.node_id) return event.node_id;
  if (event.id !== undefined) return String(event.id);
  // Last resort: hash from event type + timestamp
  return `${event.event}-${extractTimestamp(event)}`;
}
```

#### 2.5.3 Activity Event Normalization

Map GitHub user events to our action vocabulary.

**File**: `src/github/activity.ts` (NEW)

```typescript
import type { ActivityAction } from "../db/types.js";
import type { GitHubUserEvent } from "./types.js";

interface NormalizedActivity {
  action: ActivityAction;
  targetTitle: string;
  targetUrl: string | null;
}

export function normalizeUserEvent(event: GitHubUserEvent): NormalizedActivity | null {
  switch (event.type) {
    case "PushEvent": {
      const firstCommit = event.payload.commits?.[0];
      return {
        action: "committed",
        targetTitle: firstCommit?.message ?? "Push",
        targetUrl: null,
      };
    }
    case "IssueCommentEvent":
      return {
        action: "commented",
        targetTitle: event.payload.issue?.title ?? "Comment",
        targetUrl: event.payload.comment?.html_url ?? null,
      };
    case "PullRequestEvent": {
      const pr = event.payload.pull_request;
      const action = mapPullRequestAction(event.payload.action, pr?.merged);
      if (!action) return null;
      return {
        action,
        targetTitle: pr?.title ?? "Pull Request",
        targetUrl: pr?.html_url ?? null,
      };
    }
    case "PullRequestReviewEvent":
      return {
        action: "reviewed",
        targetTitle: event.payload.pull_request?.title ?? "Review",
        targetUrl: event.payload.pull_request?.html_url ?? null,
      };
    case "IssuesEvent": {
      const action = mapIssueAction(event.payload.action);
      if (!action) return null;
      return {
        action,
        targetTitle: event.payload.issue?.title ?? "Issue",
        targetUrl: event.payload.issue?.html_url ?? null,
      };
    }
    case "CreateEvent":
      return {
        action: "created",
        targetTitle: event.payload.ref
          ? `${event.payload.ref_type ?? "ref"}: ${event.payload.ref}`
          : event.payload.ref_type ?? "repository",
        targetUrl: null,
      };
    case "DeleteEvent":
      return {
        action: "deleted",
        targetTitle: event.payload.ref
          ? `${event.payload.ref_type ?? "ref"}: ${event.payload.ref}`
          : event.payload.ref_type ?? "ref",
        targetUrl: null,
      };
    case "ForkEvent":
      return {
        action: "forked",
        targetTitle: event.payload.forkee?.full_name ?? "Fork",
        targetUrl: event.payload.forkee?.html_url ?? null,
      };
    case "WatchEvent":
      return {
        action: "starred",
        targetTitle: event.repo.name,
        targetUrl: null,
      };
    case "ReleaseEvent":
      return {
        action: "released",
        targetTitle: event.payload.release?.tag_name ?? "Release",
        targetUrl: event.payload.release?.html_url ?? null,
      };
    default:
      return null;
  }
}

function mapPullRequestAction(
  action: string | undefined,
  merged: boolean | undefined,
): ActivityAction | null {
  if (action === "closed" && merged) return "merged";
  if (action === "closed") return "closed";
  if (action === "opened" || action === "reopened") return "opened";
  return null;
}

function mapIssueAction(action: string | undefined): ActivityAction | null {
  if (action === "opened" || action === "reopened") return "opened";
  if (action === "closed") return "closed";
  return null;
}
```

#### 2.5.4 Notification Poller

**File**: `src/poller/notifications.ts` (NEW)

```typescript
import type { GHDDatabase } from "../db/queries.js";
import { eventId, threadId } from "../db/types.js";
import type { GitHubClient } from "../github/client.js";
import {
  extractActor,
  extractEventId,
  extractTimestamp,
  mapEventType,
} from "../github/events.js";
import { apiUrlToHtmlUrl, parseSubjectUrl } from "../github/urls.js";

const SYNC_KEY = "notifications_last_poll";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface NotificationPollerOptions {
  intervalMs?: number;
}

export class NotificationPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly intervalMs: number;

  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    options?: NotificationPollerOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    // Run immediately, then on interval
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<{ processed: number }> {
    if (this.running) return { processed: 0 };
    this.running = true;

    try {
      const since = this.db.getSyncMeta(SYNC_KEY);
      const notifications = await this.github.listNotifications(
        since ? { since } : undefined,
      );

      let processed = 0;

      for (const notification of notifications) {
        try {
          await this.processNotification(notification);
          processed++;
        } catch (err) {
          console.error(
            `[ghd] Failed to process notification ${notification.id}:`,
            err,
          );
        }
      }

      // Update last poll timestamp
      this.db.setSyncMeta(SYNC_KEY, new Date().toISOString());

      return { processed };
    } catch (err) {
      console.error("[ghd] Notification poll failed:", err);
      return { processed: 0 };
    } finally {
      this.running = false;
    }
  }

  private async processNotification(
    notification: import("../github/types.js").GitHubNotificationThread,
  ): Promise<void> {
    const tid = threadId(notification.id);
    const subjectUrl = notification.subject.url
      ? apiUrlToHtmlUrl(notification.subject.url)
      : null;

    // Upsert the notification
    this.db.upsertNotification({
      threadId: tid,
      repository: notification.repository.full_name,
      subjectType: notification.subject.type,
      subjectTitle: notification.subject.title,
      subjectUrl,
      reason: notification.reason,
      unread: notification.unread,
      githubUpdatedAt: notification.updated_at,
      githubLastReadAt: notification.last_read_at,
    });

    // Fetch timeline events if we can parse the subject URL
    if (notification.subject.url) {
      const parsed = parseSubjectUrl(notification.subject.url);
      if (parsed) {
        await this.fetchAndStoreTimeline(tid, parsed.owner, parsed.repo, parsed.number);
      }
    }
  }

  private async fetchAndStoreTimeline(
    tid: import("../db/types.js").ThreadId,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<void> {
    const events = await this.github.getTimelineEvents(owner, repo, issueNumber);

    for (const event of events) {
      const mappedType = mapEventType(event.event);
      if (!mappedType) continue; // Skip event types we don't track

      const eid = eventId(extractEventId(event));
      this.db.upsertNotificationEvent({
        notificationThreadId: tid,
        eventId: eid,
        eventType: mappedType,
        actor: extractActor(event),
        body: event.body ?? null,
        summary: null, // Phase 4: LLM summarization
        url: event.html_url ?? null,
        eventTimestamp: extractTimestamp(event),
      });
    }
  }
}
```

#### 2.5.5 Activity Poller

**File**: `src/poller/activity.ts` (NEW)

```typescript
import type { GHDDatabase } from "../db/queries.js";
import { activityId } from "../db/types.js";
import type { GitHubClient } from "../github/client.js";
import { normalizeUserEvent } from "../github/activity.js";

const SYNC_KEY = "activity_last_poll";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PRUNE_DAYS = 30;

export interface ActivityPollerOptions {
  intervalMs?: number;
  pruneDays?: number;
}

export class ActivityPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly pruneDays: number;

  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    private readonly username: string,
    options?: ActivityPollerOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.pruneDays = options?.pruneDays ?? PRUNE_DAYS;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<{ processed: number }> {
    if (this.running) return { processed: 0 };
    this.running = true;

    try {
      const events = await this.github.listUserEvents(this.username);

      let processed = 0;

      for (const event of events) {
        const normalized = normalizeUserEvent(event);
        if (!normalized) continue;

        this.db.upsertActivity({
          eventId: activityId(event.id),
          eventType: event.type,
          repository: event.repo.name,
          action: normalized.action,
          targetTitle: normalized.targetTitle,
          targetUrl: normalized.targetUrl,
          eventTimestamp: event.created_at,
        });
        processed++;
      }

      // Prune old activity
      this.db.pruneActivity(this.pruneDays);

      // Update last poll timestamp
      this.db.setSyncMeta(SYNC_KEY, new Date().toISOString());

      return { processed };
    } catch (err) {
      console.error("[ghd] Activity poll failed:", err);
      return { processed: 0 };
    } finally {
      this.running = false;
    }
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run typecheck` passes
- [x] `bun run check` passes
- [x] `bun test` passes — poller tests use `FixtureGitHubClient` + in-memory DB

---

## Phase 2.6 — Wire Pollers into Main Process

### Overview
Update `src/bun/index.ts` to resolve the GitHub token, create the GitHub client, instantiate both pollers, and start them on launch.

### Changes Required:

#### 2.6.1 Updated Main Process

**File**: `src/bun/index.ts`
**Changes**: Add token resolution, GitHub client creation, and poller startup.

```typescript
import { BrowserWindow } from "electrobun/bun";
import { createDatabase } from "../db/client.js";
import { GHDDatabase } from "../db/queries.js";
import { FetchGitHubClient } from "../github/client.js";
import { resolveGitHubToken, resolveGitHubUsername } from "../github/token.js";
import { ActivityPoller } from "../poller/activity.js";
import { NotificationPoller } from "../poller/notifications.js";

// Initialize the database
const rawDb = createDatabase();
const db = new GHDDatabase(rawDb);

// Start pollers asynchronously (don't block window creation)
void (async () => {
  try {
    const token = await resolveGitHubToken();
    const github = new FetchGitHubClient(token);
    const username = await resolveGitHubUsername(token);

    const notificationPoller = new NotificationPoller(db, github);
    const activityPoller = new ActivityPoller(db, github, username);

    notificationPoller.start();
    activityPoller.start();

    console.log(`[ghd] Pollers started for user: ${username}`);
  } catch (err) {
    console.error("[ghd] Failed to start pollers:", err);
  }
})();

const win = new BrowserWindow({
  title: "GHD — GitHub Notification Dashboard",
  url: "views://mainview/index.html",
  frame: { width: 900, height: 700, x: 100, y: 100 },
  titleBarStyle: "hiddenInset",
});
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run typecheck` passes
- [x] `bun run check` passes
- [x] `bun test` passes

#### Manual Verification:
- [ ] `bun run dev` launches the app and console shows `[ghd] Pollers started for user: albertclerigues`
- [ ] Shortly after launch (first poll is immediate), `sqlite3 ~/.ghd/ghd.sqlite "SELECT COUNT(*) FROM notifications"` returns > 0
- [ ] Shortly after launch (first poll is immediate), `sqlite3 ~/.ghd/ghd.sqlite "SELECT COUNT(*) FROM activity"` returns > 0
- [ ] `sqlite3 ~/.ghd/ghd.sqlite "SELECT * FROM sync_meta"` shows both poll timestamps
- [ ] `sqlite3 ~/.ghd/ghd.sqlite "SELECT thread_id, subject_title, repository FROM notifications LIMIT 5"` shows real notification data

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the pollers are working correctly.

---

## Phase 2.7 — Comprehensive Tests

### Overview
All tests for Phases 2.1–2.6. This section describes the complete test suite; tests should be written alongside each phase but are collected here for reference.

### Test Files:

#### `tests/db/ghd-database.test.ts`

Tests the `GHDDatabase` class with real in-memory SQLite:

- **Notifications**: upsert insert, upsert update (same threadId updates fields), `getNotifications` default excludes dismissed, `getNotifications` with `unreadOnly`, `getNotifications` with `includeDismissed`, `dismissNotification` sets timestamp, `getNotificationByThreadId` returns null for nonexistent
- **Notification Events**: upsert insert, upsert update (same composite key updates fields), `getNotificationEvents` ordered by timestamp, upsert with null body/summary
- **Activity**: upsert insert, `ON CONFLICT DO NOTHING` for duplicate eventId, `getActivity` ordered by timestamp DESC, `getActivity` with custom limit, `pruneActivity` removes old entries
- **Sync Meta**: `getSyncMeta` returns null for nonexistent key, `setSyncMeta` insert, `setSyncMeta` upsert (updates existing), `rawQuery` returns results

#### `tests/github/client.test.ts`

Unit tests for the `FetchGitHubClient` internal helpers (URL parsing, rate-limit logic):

- `parseNextLink` extracts next URL from Link header
- `parseNextLink` returns null when no next link
- Rate limit info is updated from response headers
- URL construction for notifications with/without `since` parameter

Note: We don't test actual HTTP requests — that's the fixture client's job.

#### `tests/github/urls.test.ts`

Unit tests for URL helpers:

- `apiUrlToHtmlUrl` converts API URL to browser URL
- `parseSubjectUrl` extracts owner/repo/number from issue URL
- `parseSubjectUrl` extracts from pull URL
- `parseSubjectUrl` returns null for non-matching URLs

#### `tests/github/events.test.ts`

Unit tests for event mapping:

- `mapEventType` maps all known GitHub event strings
- `mapEventType` returns null for unknown events
- `extractActor` prefers `actor.login` over `user.login`
- `extractActor` returns "unknown" when neither exists
- `extractTimestamp` prefers `submitted_at` for reviews
- `extractEventId` prefers `node_id` over numeric `id`

#### `tests/github/activity.test.ts`

Unit tests for activity normalization:

- `normalizeUserEvent` handles PushEvent
- `normalizeUserEvent` handles IssueCommentEvent
- `normalizeUserEvent` handles PullRequestEvent (opened, closed, merged)
- `normalizeUserEvent` handles PullRequestReviewEvent
- `normalizeUserEvent` handles IssuesEvent (opened, closed)
- `normalizeUserEvent` handles CreateEvent, DeleteEvent, ForkEvent, WatchEvent, ReleaseEvent
- `normalizeUserEvent` returns null for unknown event types

#### `tests/github/token.test.ts`

Unit tests for token resolution:

- Returns env var when `GHD_GITHUB_TOKEN` is set
- Throws `GitHubTokenError` when no token source available (with both env var unset and gh CLI unavailable — test by temporarily clearing the env var)

#### `tests/poller/notifications.test.ts`

Integration tests using `FixtureGitHubClient` + in-memory DB:

- `poll()` inserts notifications from fixture data
- `poll()` inserts timeline events for each notification
- `poll()` is idempotent — second call doesn't duplicate data
- `poll()` updates `sync_meta` with last poll timestamp
- `poll()` skips notifications with unparseable subject URLs gracefully
- Event types are correctly mapped from GitHub to our vocabulary

#### `tests/poller/activity.test.ts`

Integration tests using `FixtureGitHubClient` + in-memory DB:

- `poll()` inserts normalized activity events
- `poll()` skips unknown event types
- `poll()` is idempotent for duplicate event IDs
- `poll()` updates `sync_meta` with last poll timestamp
- `poll()` prunes old activity

### Success Criteria:

#### Automated Verification:
- [x] `bun run typecheck` passes
- [x] `bun run check` passes
- [x] `bun test` passes — all tests green
- [x] No test uses mocking libraries — only real infrastructure or fixture implementations

---

## Testing Strategy

### Unit Tests:
- URL conversion and parsing (`src/github/urls.ts`)
- Event type mapping (`src/github/events.ts`)
- Activity normalization (`src/github/activity.ts`)
- Token resolution error paths (`src/github/token.ts`)
- Link header parsing (extracted from `FetchGitHubClient`)

### Integration Tests:
- `GHDDatabase` full CRUD lifecycle against real in-memory SQLite
- Notification poller end-to-end with `FixtureGitHubClient` + in-memory DB
- Activity poller end-to-end with `FixtureGitHubClient` + in-memory DB

### What's NOT Tested:
- Real HTTP calls to GitHub API (tested manually via `bun run dev`)
- `resolveGitHubUsername` (requires network)
- Electrobun window rendering
- Timer-based polling intervals (tested via direct `poll()` calls)

## Performance Considerations

- Notification polling is incremental via `since` parameter — only fetches updates since last poll
- Timeline fetches happen per-notification, which could be expensive for many active threads. Acceptable for now; can batch or rate-limit in Phase 7.
- Activity polling fetches only the first page (30 events) — GitHub Events API has inherent limits
- `ON CONFLICT DO NOTHING` for activity prevents duplicate processing
- `ON CONFLICT DO UPDATE` for notifications handles re-processing gracefully
- Pruning old activity keeps the DB lean (30-day default)

## References

- Design doc: `docs/design.md` (Phase 2 section, data models, GitHub API)
- Phase 1 plan: `docs/plans/2026-03-10-phase-1-foundation.md`
- GitHub Notifications API: https://docs.github.com/en/rest/activity/notifications
- GitHub Timeline Events API: https://docs.github.com/en/rest/issues/timeline
- GitHub User Events API: https://docs.github.com/en/rest/activity/events
- `gh auth token`: https://cli.github.com/manual/gh_auth_token
