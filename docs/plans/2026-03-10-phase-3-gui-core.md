# Phase 3: GUI Core — Implementation Plan

## Overview

Connect the data layer (Phase 2) to the WebView through Electrobun's typed RPC system, and build the three tab renderers: a notifications list with inline event subtrees, a pinned card layout grouped by section, and an activity table with colored action badges. Mutations from the pollers push real-time invalidation messages to the WebView so it re-fetches and re-renders only the affected tab.

## Current State Analysis

- **Database layer**: Fully operational. All read methods exist (`getNotifications`, `getNotificationEvents`, `getActivity`, `getPinnedGrouped`). Pin write methods (`pinItem`, `unpinItem`) are noted as deferred at `src/db/queries.ts:152`.
- **RPC schema**: Skeleton with empty `Record<string, never>` on both sides (`src/shared/rpc.ts`).
- **Bun main process**: Creates `BrowserWindow` without passing an `rpc` object (`src/bun/index.ts:32-37`). Pollers run but have no way to notify the WebView.
- **WebView**: Tab switching works. No RPC connection, no data rendering — three placeholder `<p>` elements (`src/mainview/index.html:19-27`).

### Key Discoveries
- Electrobun RPC uses `BrowserView.defineRPC<Schema>()` on Bun side, returns an `rpc` object that must be passed to `new BrowserWindow({ rpc })`.
- WebView uses `Electroview.defineRPC<Schema>()` + `new Electroview({ rpc })`.
- `bun.requests` = handlers the Bun process exposes (WebView calls these). `webview.messages` = fire-and-forget pushes the WebView receives (Bun sends these).
- The `rpc.send()` / `rpc.sendProxy` on the Bun side sends typed messages to the WebView. From `BrowserWindow`, access via `win.webview.rpc.send(...)`.
- Default RPC request timeout is 1000ms — will need `maxRequestTime` override for potentially slow DB queries.
- Branded ID types (`ThreadId`, `PinId`) cannot cross the RPC boundary directly — RPC params/responses use plain `string`/`number`.

## Desired End State

The app displays live data in all three tabs:
- **Notifications tab**: Each notification shows subject title, type icon, repository, and an indented event subtree using box-drawing characters. Each event line shows type, actor, relative timestamp, and LLM summary (when present, prefixed with sparkle).
- **Pinned tab**: Cards grouped under named section headers. Each card shows item type, title, repository, and a pin/unpin button (button present but non-functional — wiring deferred).
- **Activity tab**: Full-width table with action (colored badge), target, repository, and relative timestamp columns.
- **Real-time push**: When pollers store new data, the WebView re-fetches and re-renders the affected tab without manual refresh.

### Verification
- `bun run check` passes (format + lint)
- `bun run typecheck` passes
- `bun test` passes (existing + new tests)
- `bun run dev` launches window showing real notification/activity data
- Notifications show event subtrees inline
- Tab switching works, each tab renders its data
- New poll results appear in the GUI without manual refresh

## What We're NOT Doing

- **Keyboard navigation** (Phase 5) — no arrow-key focus model, no Enter to open, no Space to dismiss
- **`openInBrowser`** (Phase 5) — clicking items does not open URLs
- **Pin/unpin write operations** (Phase 6 CLI) — buttons render but are non-functional
- **LLM summaries** (Phase 4) — summaries display if present in DB, but no summarizer integration
- **Error states / empty states** (Phase 7 polish) — minimal placeholder for empty tabs, no retry UI

---

## Phase 3.1: RPC Schema + Pin CRUD + Bun Handlers

### Overview
Define the full typed RPC contract, add the missing pin write methods to `GHDDatabase`, wire all RPC request handlers in the Bun main process, and connect the pollers to push invalidation messages to the WebView.

### Changes Required

#### 3.1.1 RPC Schema

**File**: `src/shared/rpc.ts`

Replace the empty stubs with the full contract. RPC params/responses use plain types (not branded IDs) since they cross the serialization boundary.

```typescript
import type { ElectrobunRPCSchema, RPCSchema } from "electrobun";

// Row shapes for RPC responses (mirrors DB rows but explicitly typed for the boundary)
export interface NotificationWithEvents {
  threadId: string;
  repository: string;
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string | null;
  reason: string;
  unread: boolean;
  githubUpdatedAt: string;
  events: NotificationEventData[];
}

export interface NotificationEventData {
  eventId: string;
  eventType: string;
  actor: string;
  body: string | null;
  summary: string | null;
  url: string | null;
  eventTimestamp: string;
}

export interface PinnedGroupData {
  groupName: string;
  items: PinnedItemData[];
}

export interface PinnedItemData {
  id: number;
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string;
  repository: string;
  notificationThreadId: string | null;
}

export interface ActivityData {
  eventId: string;
  eventType: string;
  repository: string;
  action: string;
  targetTitle: string;
  targetUrl: string | null;
  eventTimestamp: string;
}

export type UpdatedScope = "notifications" | "pinned" | "activity";

export type GHDRpcSchema = ElectrobunRPCSchema & {
  bun: RPCSchema<{
    requests: {
      getNotifications: {
        params: undefined;
        response: NotificationWithEvents[];
      };
      getPinned: {
        params: undefined;
        response: PinnedGroupData[];
      };
      getActivity: {
        params: { limit?: number };
        response: ActivityData[];
      };
      markDone: {
        params: { threadId: string };
        response: void;
      };
      pinItem: {
        params: {
          subjectType: string;
          subjectTitle: string;
          subjectUrl: string;
          repository: string;
          groupName?: string;
          notificationThreadId?: string;
        };
        response: { id: number };
      };
      unpinItem: {
        params: { id: number };
        response: void;
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      stateUpdated: { scope: UpdatedScope };
    };
  }>;
};
```

**Design decisions:**
- `getNotifications` returns notifications with their events pre-joined — avoids N+1 RPC calls from the WebView.
- `getPinned` returns an array of groups (not a Map, which doesn't serialize) with items nested.
- `markDone`, `pinItem`, `unpinItem` are included for completeness of the RPC contract even though the WebView won't wire click handlers to them until Phase 5/6.
- `stateUpdated` is a message (fire-and-forget) with a `scope` discriminant so the WebView knows which tab to re-fetch.

#### 3.1.2 Pin CRUD Methods

**File**: `src/db/queries.ts`

Add `pinItem`, `unpinItem`, and update the comment at line 152.

```typescript
// --- Pinned ---

pinItem(input: {
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string;
  repository: string;
  groupName?: string;
  notificationThreadId?: ThreadId | null;
}): PinId {
  const groupName = input.groupName ?? "Default";
  // Place at end of group: max(sort_order) + 1
  const maxOrder = this.db
    .query<{ max_order: number | null }, [string]>(
      "SELECT MAX(sort_order) as max_order FROM pinned WHERE group_name = ?1",
    )
    .get(groupName);
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  this.db.run(
    `INSERT INTO pinned (
      notification_thread_id, subject_type, subject_title, subject_url,
      repository, group_name, sort_order
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    [
      input.notificationThreadId ?? null,
      input.subjectType,
      input.subjectTitle,
      input.subjectUrl,
      input.repository,
      groupName,
      sortOrder,
    ],
  );

  const row = this.db
    .query<{ id: number }, []>("SELECT last_insert_rowid() as id")
    .get();
  return pinId(row!.id);
}

unpinItem(id: PinId): void {
  this.db.run("DELETE FROM pinned WHERE id = ?1", [id]);
}
```

**Import additions**: Add `PinId` and `pinId` to the imports from `./types.js`.

#### 3.1.3 Bun Main Process — RPC Handlers

**File**: `src/bun/index.ts`

Restructure to create `rpc` before `BrowserWindow`, register handlers that call `GHDDatabase`, and pass `rpc` to the window. Also store `win` reference so pollers can push messages.

```typescript
import { BrowserView, BrowserWindow } from "electrobun";
import { createDatabase } from "../db/client.js";
import { GHDDatabase } from "../db/queries.js";
import { threadId, pinId } from "../db/types.js";
import { FetchGitHubClient } from "../github/client.js";
import { resolveGitHubToken, resolveGitHubUsername } from "../github/token.js";
import { ActivityPoller } from "../poller/activity.js";
import { NotificationPoller } from "../poller/notifications.js";
import type { GHDRpcSchema, NotificationWithEvents, PinnedGroupData, ActivityData } from "../shared/rpc.js";

// Initialize the database
const rawDb = createDatabase();
const db = new GHDDatabase(rawDb);

// Define RPC handlers
const rpc = BrowserView.defineRPC<GHDRpcSchema>({
  maxRequestTime: 5000,
  handlers: {
    requests: {
      getNotifications: () => {
        const notifications = db.getNotifications();
        const result: NotificationWithEvents[] = notifications.map((n) => ({
          threadId: n.thread_id,
          repository: n.repository,
          subjectType: n.subject_type,
          subjectTitle: n.subject_title,
          subjectUrl: n.subject_url,
          reason: n.reason,
          unread: n.unread === 1,
          githubUpdatedAt: n.github_updated_at,
          events: db.getNotificationEvents(threadId(n.thread_id)).map((e) => ({
            eventId: e.event_id,
            eventType: e.event_type,
            actor: e.actor,
            body: e.body,
            summary: e.summary,
            url: e.url,
            eventTimestamp: e.event_timestamp,
          })),
        }));
        return result;
      },

      getPinned: () => {
        const grouped = db.getPinnedGrouped();
        const result: PinnedGroupData[] = [];
        for (const [groupName, items] of grouped) {
          result.push({
            groupName,
            items: items.map((p) => ({
              id: p.id,
              subjectType: p.subject_type,
              subjectTitle: p.subject_title,
              subjectUrl: p.subject_url,
              repository: p.repository,
              notificationThreadId: p.notification_thread_id,
            })),
          });
        }
        return result;
      },

      getActivity: ({ limit }) => {
        const rows = db.getActivity({ limit: limit ?? 100 });
        const result: ActivityData[] = rows.map((a) => ({
          eventId: a.event_id,
          eventType: a.event_type,
          repository: a.repository,
          action: a.action,
          targetTitle: a.target_title,
          targetUrl: a.target_url,
          eventTimestamp: a.event_timestamp,
        }));
        return result;
      },

      markDone: ({ threadId: tid }) => {
        db.dismissNotification(threadId(tid));
        win.webview.rpc.send("stateUpdated", { scope: "notifications" });
      },

      pinItem: (params) => {
        const id = db.pinItem({
          subjectType: params.subjectType,
          subjectTitle: params.subjectTitle,
          subjectUrl: params.subjectUrl,
          repository: params.repository,
          groupName: params.groupName,
          notificationThreadId: params.notificationThreadId
            ? threadId(params.notificationThreadId)
            : null,
        });
        win.webview.rpc.send("stateUpdated", { scope: "pinned" });
        return { id: id as number };
      },

      unpinItem: ({ id }) => {
        db.unpinItem(pinId(id));
        win.webview.rpc.send("stateUpdated", { scope: "pinned" });
      },
    },
    messages: {},
  },
});

// Create window with RPC
const win = new BrowserWindow({
  title: "GHD — GitHub Notification Dashboard",
  url: "views://mainview/index.html",
  frame: { width: 900, height: 700, x: 100, y: 100 },
  titleBarStyle: "hiddenInset",
  rpc,
});

// Start pollers asynchronously (don't block window creation)
void (async () => {
  try {
    const token = await resolveGitHubToken();
    const github = new FetchGitHubClient(token);
    const username = await resolveGitHubUsername(token);

    const notificationPoller = new NotificationPoller(db, github, {
      onSync: () => {
        win.webview.rpc.send("stateUpdated", { scope: "notifications" });
      },
    });
    const activityPoller = new ActivityPoller(db, github, username, {
      onSync: () => {
        win.webview.rpc.send("stateUpdated", { scope: "activity" });
      },
    });

    notificationPoller.start();
    activityPoller.start();

    console.log(`[ghd] Pollers started for user: ${username}`);
  } catch (err) {
    console.error("[ghd] Failed to start pollers:", err);
  }
})();
```

#### 3.1.4 Poller `onSync` Callback

**File**: `src/poller/notifications.ts`

Add an optional `onSync` callback to the constructor options that fires after each successful poll.

```typescript
interface NotificationPollerOptions {
  intervalMs?: number;
  onSync?: () => void;
}

export class NotificationPoller {
  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    private readonly options?: NotificationPollerOptions,
  ) { ... }

  // At end of poll(), after successful sync:
  // this.options?.onSync?.();
}
```

**File**: `src/poller/activity.ts`

Same pattern — add optional `onSync` callback.

```typescript
interface ActivityPollerOptions {
  intervalMs?: number;
  onSync?: () => void;
}

export class ActivityPoller {
  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    private readonly username: string,
    private readonly options?: ActivityPollerOptions,
  ) { ... }
```

**Important**: The existing constructor signatures change (new optional 4th param for `ActivityPoller`, new optional 3rd param for `NotificationPoller`). Existing callers in tests pass only 2-3 args, so this is backward-compatible.

### Success Criteria

#### Automated Verification:
- [ ] `bun run check` passes
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes — all existing tests still pass
- [ ] New tests pass for `pinItem` and `unpinItem` in `tests/db/ghd-database.test.ts`

#### Manual Verification:
- [ ] `bun run dev` launches without errors in the console

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 3.2: WebView RPC + Data Fetching

### Overview
Connect the WebView to the Bun process through Electrobun's RPC, implement data-fetching functions for each tab, and wire the `stateUpdated` message handler to re-fetch and re-render the active tab.

### Changes Required

#### 3.2.1 WebView RPC Setup

**File**: `src/mainview/index.ts`

Replace the current tab-only code with full RPC initialization and data fetching. The WebView calls `rpc.request("getNotifications")` etc. on initial load and when `stateUpdated` arrives.

```typescript
import { Electroview } from "electrobun/view";
import type {
  GHDRpcSchema,
  NotificationWithEvents,
  PinnedGroupData,
  ActivityData,
} from "../shared/rpc.js";

// --- RPC Setup ---

const rpc = Electroview.defineRPC<GHDRpcSchema>({
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      stateUpdated: ({ scope }) => {
        void refreshTab(scope);
      },
    },
  },
});

const view = new Electroview({ rpc });

// --- Tab Management ---

function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
  const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

  for (const tab of tabs) {
    tab.addEventListener("mousedown", (e) => e.stopPropagation());
    tab.addEventListener("click", () => {
      const target = tab.dataset["tab"];
      if (!target) return;

      for (const t of tabs) t.classList.remove("active");
      for (const p of panels) p.classList.remove("active");

      tab.classList.add("active");
      document.getElementById(`tab-${target}`)?.classList.add("active");

      // Fetch data for the newly active tab
      void refreshTab(target as "notifications" | "pinned" | "activity");
    });
  }
}

// --- Data Fetching & Rendering ---

async function refreshTab(scope: "notifications" | "pinned" | "activity"): Promise<void> {
  switch (scope) {
    case "notifications":
      return refreshNotifications();
    case "pinned":
      return refreshPinned();
    case "activity":
      return refreshActivity();
  }
}

async function refreshNotifications(): Promise<void> {
  const data = await rpc.request("getNotifications", undefined);
  renderNotifications(data);
}

async function refreshPinned(): Promise<void> {
  const data = await rpc.request("getPinned", undefined);
  renderPinned(data);
}

async function refreshActivity(): Promise<void> {
  const data = await rpc.request("getActivity", { limit: 100 });
  renderActivity(data);
}

// --- Rendering (implemented in Phase 3.3 and 3.4) ---

function renderNotifications(data: NotificationWithEvents[]): void {
  // Phase 3.3
}

function renderPinned(data: PinnedGroupData[]): void {
  // Phase 3.4
}

function renderActivity(data: ActivityData[]): void {
  // Phase 3.4
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  // Fetch initial data for the default active tab
  void refreshNotifications();
});
```

**Note**: `Electroview` import is from `"electrobun/view"`. The `view` variable is kept for future use (Phase 5+) but is needed for the RPC transport setup.

### Success Criteria

#### Automated Verification:
- [ ] `bun run check` passes
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

#### Manual Verification:
- [ ] `bun run dev` — no errors in console, RPC connection established
- [ ] Switching tabs triggers data fetch (visible in Bun process console if you add a log)

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 3.3: Notifications Renderer

### Overview
Build the notifications list renderer with inline event subtrees using box-drawing characters, type icons, relative timestamps, and LLM summary display.

### Changes Required

#### 3.3.1 Utility — Relative Time Formatter

**File**: `src/mainview/format.ts` (new file)

A pure function for rendering relative timestamps. No dependencies.

```typescript
export function relativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  if (diffHour < 24) return `${String(diffHour)}h ago`;
  if (diffDay < 30) return `${String(diffDay)}d ago`;
  return new Date(isoTimestamp).toLocaleDateString();
}
```

#### 3.3.2 Utility — Subject Type Icons

**File**: `src/mainview/format.ts` (same file, append)

```typescript
const SUBJECT_TYPE_ICONS: Record<string, string> = {
  Issue: "\u{25CB}",      // ○
  PullRequest: "\u{21C4}", // ⇄
  Discussion: "\u{2637}", // ☷
  Release: "\u{25C6}",    // ◆
  Commit: "\u{2022}",     // •
};

export function subjectTypeIcon(subjectType: string): string {
  return SUBJECT_TYPE_ICONS[subjectType] ?? "\u{25CB}";
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  comment: "commented",
  review: "reviewed",
  review_request: "review requested",
  merge: "merged",
  close: "closed",
  reopen: "reopened",
  label: "labeled",
  assignment: "assigned",
  rename: "renamed",
  reference: "referenced",
  commit: "committed",
};

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}
```

#### 3.3.3 Notifications Renderer

**File**: `src/mainview/index.ts` — implement `renderNotifications`

The renderer builds DOM elements for each notification. Each notification is a block with:
- Line 1: type icon + subject title + repository (right-aligned, muted)
- Line 2+: indented event tree with box-drawing characters

```typescript
function renderNotifications(data: NotificationWithEvents[]): void {
  const container = document.getElementById("tab-notifications");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = '<p class="placeholder">No notifications.</p>';
    return;
  }

  container.innerHTML = "";

  for (const notif of data) {
    const block = document.createElement("div");
    block.className = "notification-block";
    if (notif.unread) block.classList.add("unread");
    block.dataset["threadId"] = notif.threadId;

    // Header line
    const header = document.createElement("div");
    header.className = "notification-header";
    header.innerHTML = `
      <span class="notification-icon">${subjectTypeIcon(notif.subjectType)}</span>
      <span class="notification-title">${escapeHtml(notif.subjectTitle)}</span>
      <span class="notification-repo">${escapeHtml(notif.repository)}</span>
      <span class="notification-time">${relativeTime(notif.githubUpdatedAt)}</span>
    `;
    block.appendChild(header);

    // Event subtree
    if (notif.events.length > 0) {
      const tree = document.createElement("div");
      tree.className = "event-tree";

      for (let i = 0; i < notif.events.length; i++) {
        const event = notif.events[i]!;
        const isLast = i === notif.events.length - 1;
        const connector = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500"; // └── or ├──

        const line = document.createElement("div");
        line.className = "event-line";

        let summaryHtml = "";
        if (event.summary) {
          summaryHtml = ` <span class="event-summary">\u2728 ${escapeHtml(event.summary)}</span>`;
        }

        line.innerHTML = `
          <span class="tree-connector">${connector}</span>
          <span class="event-type">${eventTypeLabel(event.eventType)}</span>
          <span class="event-actor">${escapeHtml(event.actor)}</span>
          <span class="event-time">${relativeTime(event.eventTimestamp)}</span>
          ${summaryHtml}
        `;
        tree.appendChild(line);
      }

      block.appendChild(tree);
    }

    container.appendChild(block);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
```

#### 3.3.4 Notifications CSS

**File**: `src/mainview/index.css` — append notification styles

```css
/* --- Notifications --- */

.notification-block {
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.notification-block.unread {
  border-left: 3px solid var(--accent);
  padding-left: 9px;
}

.notification-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.notification-icon {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  color: var(--text-muted);
}

.notification-title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notification-repo {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.notification-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  min-width: 50px;
  text-align: right;
}

/* Event tree */

.event-tree {
  margin-top: 4px;
  padding-left: 28px;
}

.event-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  line-height: 22px;
  color: var(--text-muted);
}

.tree-connector {
  font-family: monospace;
  color: var(--border);
  flex-shrink: 0;
}

.event-type {
  color: var(--accent);
  font-size: 12px;
  flex-shrink: 0;
}

.event-actor {
  color: var(--text);
  font-size: 12px;
}

.event-time {
  font-size: 11px;
  flex-shrink: 0;
}

.event-summary {
  font-size: 12px;
  color: var(--text);
  font-style: italic;
}
```

### Success Criteria

#### Automated Verification:
- [ ] `bun run check` passes
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes — new unit tests for `relativeTime`, `subjectTypeIcon`, `eventTypeLabel`, and `escapeHtml`

#### Manual Verification:
- [ ] `bun run dev` shows notifications with event subtrees
- [ ] Unread notifications have a blue left border
- [ ] Event tree uses box-drawing connectors (├── and └──)
- [ ] Relative timestamps render correctly (e.g., "5m ago", "2h ago")
- [ ] LLM summaries show with sparkle prefix when present in DB

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 3.4: Pinned & Activity Renderers

### Overview
Build the pinned card layout with group headers and the activity table with colored action badges.

### Changes Required

#### 3.4.1 Activity Action Badge Colors

**File**: `src/mainview/format.ts` — append

```typescript
const ACTION_COLORS: Record<string, string> = {
  committed: "#a6e3a1",  // green
  commented: "#89b4fa",  // blue
  opened: "#a6e3a1",     // green
  closed: "#f38ba8",     // red
  merged: "#cba6f7",     // purple
  reviewed: "#f9e2af",   // yellow
  created: "#a6e3a1",    // green
  deleted: "#f38ba8",    // red
  forked: "#89b4fa",     // blue
  starred: "#f9e2af",    // yellow
  released: "#94e2d5",   // teal
};

export function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? "var(--text-muted)";
}
```

#### 3.4.2 Pinned Renderer

**File**: `src/mainview/index.ts` — implement `renderPinned`

```typescript
function renderPinned(data: PinnedGroupData[]): void {
  const container = document.getElementById("tab-pinned");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = '<p class="placeholder">No pinned items.</p>';
    return;
  }

  container.innerHTML = "";

  for (const group of data) {
    const section = document.createElement("div");
    section.className = "pin-group";

    const groupHeader = document.createElement("h3");
    groupHeader.className = "pin-group-header";
    groupHeader.textContent = group.groupName;
    section.appendChild(groupHeader);

    const grid = document.createElement("div");
    grid.className = "pin-grid";

    for (const item of group.items) {
      const card = document.createElement("div");
      card.className = "pin-card";
      card.dataset["pinId"] = String(item.id);

      card.innerHTML = `
        <div class="pin-card-header">
          <span class="pin-card-icon">${subjectTypeIcon(item.subjectType)}</span>
          <span class="pin-card-type">${escapeHtml(item.subjectType)}</span>
        </div>
        <div class="pin-card-title">${escapeHtml(item.subjectTitle)}</div>
        <div class="pin-card-repo">${escapeHtml(item.repository)}</div>
        <button type="button" class="pin-card-unpin" disabled>Unpin</button>
      `;
      grid.appendChild(card);
    }

    section.appendChild(grid);
    container.appendChild(section);
  }
}
```

**Note**: The "Unpin" button is rendered with `disabled` — it will be wired in a later phase.

#### 3.4.3 Activity Renderer

**File**: `src/mainview/index.ts` — implement `renderActivity`

```typescript
function renderActivity(data: ActivityData[]): void {
  const container = document.getElementById("tab-activity");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = '<p class="placeholder">No activity.</p>';
    return;
  }

  const table = document.createElement("table");
  table.className = "activity-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>Action</th>
        <th>Target</th>
        <th>Repository</th>
        <th>Time</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  for (const item of data) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <span class="action-badge" style="background: ${actionColor(item.action)}">
          ${escapeHtml(item.action)}
        </span>
      </td>
      <td class="activity-target">${escapeHtml(item.targetTitle)}</td>
      <td class="activity-repo">${escapeHtml(item.repository)}</td>
      <td class="activity-time">${relativeTime(item.eventTimestamp)}</td>
    `;
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  container.innerHTML = "";
  container.appendChild(table);
}
```

#### 3.4.4 Pinned & Activity CSS

**File**: `src/mainview/index.css` — append

```css
/* --- Pinned --- */

.pin-group {
  margin-bottom: 24px;
}

.pin-group-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.pin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.pin-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pin-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.pin-card-icon {
  font-size: 14px;
}

.pin-card-title {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pin-card-repo {
  font-size: 12px;
  color: var(--text-muted);
}

.pin-card-unpin {
  align-self: flex-end;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: not-allowed;
}

/* --- Activity --- */

.activity-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.activity-table th {
  text-align: left;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
}

.activity-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.action-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--bg);
}

.activity-target {
  max-width: 300px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-repo {
  color: var(--text-muted);
}

.activity-time {
  color: var(--text-muted);
  white-space: nowrap;
}
```

### Success Criteria

#### Automated Verification:
- [ ] `bun run check` passes
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes — add unit test for `actionColor`

#### Manual Verification:
- [ ] Pinned tab shows cards grouped under section headers
- [ ] Cards show type icon, title, repository, and disabled "Unpin" button
- [ ] Grid layout adjusts columns based on window width
- [ ] Activity tab shows table with colored action badges
- [ ] Relative timestamps render correctly

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 3.5: Real-time Push

### Overview
Wire the pollers to push `stateUpdated` messages through the Bun→WebView RPC channel after each successful sync, so the GUI stays in sync without polling or manual refresh.

### Changes Required

This phase is mostly about verifying the end-to-end flow, since the wiring was set up in Phase 3.1 (poller `onSync` callbacks) and Phase 3.2 (`stateUpdated` message handler). The remaining work:

#### 3.5.1 Refresh All Tabs on Initial Load

**File**: `src/mainview/index.ts`

Currently only `refreshNotifications()` is called on `DOMContentLoaded`. Change to also pre-fetch pinned and activity so they're ready when the user switches tabs (avoids a visible flash on first switch).

```typescript
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  void refreshNotifications();
  void refreshPinned();
  void refreshActivity();
});
```

#### 3.5.2 Guard Against Rendering Inactive Tabs

The `stateUpdated` handler currently calls `refreshTab(scope)` regardless of which tab is active. This is fine — the DOM is updated even if the panel is hidden. However, if performance becomes a concern, we could gate on the active tab. For now, always re-fetch — the queries are fast (local SQLite) and the render is cheap (small DOM).

#### 3.5.3 Verify End-to-End

No code changes needed — this is a manual verification step to confirm:
1. Poller runs → stores data → calls `onSync` → Bun sends `stateUpdated` → WebView re-fetches → DOM updates.
2. Multiple rapid polls don't cause race conditions (each `refreshTab` replaces the entire container content).

### Success Criteria

#### Automated Verification:
- [ ] `bun run check` passes
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

#### Manual Verification:
- [ ] Launch app, wait for first poll cycle (up to 15 minutes, or trigger manually by restarting)
- [ ] Notifications tab updates with new data without manual refresh
- [ ] Activity tab updates with new data without manual refresh
- [ ] No console errors during push updates
- [ ] Switching tabs after a push shows updated data

---

## Testing Strategy

### Unit Tests (new)

**File**: `tests/db/ghd-database.test.ts` — add to existing file:
- `pinItem` inserts a pin with default group and correct sort order
- `pinItem` with explicit group name
- `pinItem` auto-increments sort order within a group
- `unpinItem` removes the pin
- `unpinItem` is idempotent (no error on nonexistent id)

**File**: `tests/mainview/format.test.ts` (new):
- `relativeTime` returns "just now" for recent timestamps
- `relativeTime` returns "Xm ago" for minutes
- `relativeTime` returns "Xh ago" for hours
- `relativeTime` returns "Xd ago" for days
- `relativeTime` returns date string for old timestamps
- `subjectTypeIcon` returns correct icons for known types
- `subjectTypeIcon` returns default for unknown types
- `eventTypeLabel` returns correct labels
- `actionColor` returns correct colors for known actions
- `actionColor` returns fallback for unknown actions

### Integration Tests

No new integration tests in this phase — the RPC layer is an Electrobun integration that we trust to the framework (per design doc). The pollers are already tested against the fixture client. End-to-end verification is manual.

### What's NOT Tested

- Electrobun RPC transport (framework responsibility)
- DOM rendering (manual verification — no browser test harness)
- CSS layout (manual verification)

## References

- Design spec: `docs/design.md:87-95` (UI layout), `docs/design.md:81-83` (RPC contract)
- Phase 1 plan: `docs/plans/2026-03-10-phase-1-foundation.md`
- Phase 2 plan: `docs/plans/2026-03-10-phase-2-data-pipeline.md`
- Electrobun RPC types: `node_modules/electrobun/dist/api/shared/rpc.ts:452-538`
- Electrobun BrowserView: `node_modules/electrobun/dist/api/bun/core/BrowserView.ts:338`
- Electrobun Electroview: `node_modules/electrobun/dist/api/browser/index.ts:136-168`
