# Phase 5: Keyboard Navigation — Implementation Plan

## Overview

Add full keyboard-driven navigation to the notifications tab: arrow keys to move focus between notifications and their sub-events, Enter to open the focused item in the default browser (marking the thread as read on GitHub), Space to mark a notification as done, and a floating preview box that shows parent notification context when browsing sub-events. Also wire the `openInBrowser` RPC method that was deferred from Phase 3.

## Current State Analysis

- **No keyboard handling** — zero `keydown`/`keyup` listeners anywhere in the mainview
- **No `tabindex` attributes** — no elements are focusable beyond the tab buttons
- **No `openInBrowser` RPC method** — deferred from Phase 3 per `docs/plans/2026-03-10-phase-3-gui-core.md:42`
- **`markDone` RPC exists** but is never called from the WebView (`src/bun/index.ts:89-93`)
- **`markThreadAsRead` exists** on `GitHubClient` (`src/github/client.ts:31,83`) but is not called from `markDone`
- **Electrobun exposes `openExternal`** via `Utils.openExternal(url)` from `"electrobun"` — opens URLs in default browser
- **Notification blocks** already have `data-thread-id` attributes and `.notification-block` class
- **Event lines** already have `.event-line` class but no data attributes for URLs
- **Notification data** includes `subjectUrl` (browser URL for the thread) and each event has `url` (deep-link to comment)

### Key Discoveries

- `Utils.openExternal(url)` is the Electrobun API for opening URLs in the system browser (`node_modules/electrobun/dist/api/bun/core/Utils.ts:33`)
- The `markDone` handler already writes `dismissed_at` to the DB and pushes `stateUpdated` to the WebView (`src/bun/index.ts:89-93`)
- `markThreadAsRead` on the GitHub client does a `PATCH /notifications/threads/{id}` to mark as read on GitHub (`src/github/client.ts:83`)
- The floating preview box (design doc line 91) shows parent notification context when navigating sub-events — this is purely a WebView UI concern

## Desired End State

After this plan is complete:

1. **Arrow key navigation**: Up/Down moves focus between notification blocks; Right enters a notification's event subtree; Left exits back to the notification level
2. **Enter**: Opens the focused item in the default browser — notification opens `subjectUrl`, event opens its `url`; also marks the parent thread as read on GitHub
3. **Space**: Marks the focused notification as done (dismissed) — removes it from the list
4. **Floating preview box**: When browsing sub-events (after pressing Right), a fixed-position box in the top-right shows the parent notification's title, type, repo, and summary
5. **Tab switching**: 1/2/3 keys switch between Notifications/Pinned/Activity tabs
6. **Visual focus indicator**: Clear highlight on the focused item (accent border or background)
7. **`openInBrowser` RPC method**: Added to the schema and wired on the Bun side

### Verification

- `bun run check` passes
- `bun run typecheck` passes
- `bun test` passes (existing + new tests)
- `bun run dev` — notifications tab is fully operable without a mouse
- Pressing Enter opens the correct URL in the system browser
- Pressing Space dismisses the focused notification

## What We're NOT Doing

- **Keyboard navigation for Pinned and Activity tabs** — only the notifications tab gets the full arrow-key model; other tabs can be added later
- **Drag-and-drop reordering** — not part of keyboard navigation
- **Vim-style keybindings** (j/k) — deferred; arrow keys only for now
- **Search/filter** — not part of this phase
- **Pin from keyboard** — pinning requires Phase 6 CLI integration

---

## Phase 5.1: `openInBrowser` RPC + GitHub Mark-as-Read

### Overview

Add the `openInBrowser` RPC method that opens a URL in the system browser and optionally marks a notification thread as read on GitHub. This is the foundation for Enter-key behavior.

### Changes Required

#### 5.1.1 Update RPC Schema

**File**: `src/shared/rpc.ts`

Add `openInBrowser` to the `bun.requests`:

```typescript
openInBrowser: {
  params: { url: string; threadId?: string };
  response: undefined;
};
```

The optional `threadId` allows the caller to associate a URL open with marking a specific notification as read on GitHub.

#### 5.1.2 Implement RPC Handler

**File**: `src/bun/index.ts`

Add to the `requests` object inside `BrowserView.defineRPC`:

```typescript
import { Utils } from "electrobun";

openInBrowser: ({ url, threadId: tid }) => {
  Utils.openExternal(url);
  if (tid) {
    // Mark as read on GitHub (fire-and-forget)
    void githubClient?.markThreadAsRead(tid).catch((err) => {
      console.error("[ghd] Failed to mark thread as read:", err);
    });
  }
  return undefined;
},
```

The `githubClient` reference needs to be made available to the RPC handlers. Currently it's created inside the async IIFE. We'll hoist a `let githubClient: FetchGitHubClient | undefined` to module scope and assign it inside the IIFE.

```typescript
// Module-level (after db initialization)
let githubClient: FetchGitHubClient | undefined;

// Inside the async IIFE, after creating the client:
githubClient = github;
```

#### 5.1.3 Update markDone to Also Mark Read on GitHub

**File**: `src/bun/index.ts`

Enhance the existing `markDone` handler to also mark the thread as read on GitHub, since dismissing a notification implies the user has seen it:

```typescript
markDone: ({ threadId: tid }) => {
  db.dismissNotification(threadId(tid));
  // Also mark as read on GitHub (fire-and-forget)
  void githubClient?.markThreadAsRead(tid).catch((err) => {
    console.error("[ghd] Failed to mark thread as read:", err);
  });
  win.webview.rpc?.send("stateUpdated", { scope: "notifications" });
  return undefined;
},
```

### Success Criteria

#### Automated Verification:
- [x] `bun run check` passes
- [x] `bun run typecheck` passes
- [x] `bun test` passes

#### Manual Verification:
- [ ] None yet — no WebView caller wired

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5.2: Focus Management System

### Overview

Build the keyboard focus model: a `FocusManager` class that tracks which notification (and optionally which sub-event within it) is focused, handles arrow key navigation, and applies visual focus styles. This is the core of the keyboard navigation system.

### Changes Required

#### 5.2.1 New Module: Focus Manager

**File**: `src/mainview/focus.ts`

A class that manages focus state for the notifications list. It tracks:
- `focusedIndex`: which notification block is focused (0-based, -1 = none)
- `subFocusIndex`: which event within the focused notification is focused (-1 = notification header level)
- `isInSubItems`: whether we're navigating within a notification's event tree

```typescript
export interface FocusState {
  /** Index of the focused notification block (-1 = none) */
  notificationIndex: number;
  /** Index of the focused event within the notification (-1 = notification level) */
  eventIndex: number;
  /** Whether focus is inside the event subtree */
  inSubItems: boolean;
}

export type FocusChangeCallback = (state: FocusState) => void;

export class FocusManager {
  private notificationIndex = -1;
  private eventIndex = -1;
  private inSubItems = false;
  private notificationCount = 0;
  private eventCounts: number[] = [];
  private onChange: FocusChangeCallback | undefined;

  setOnChange(callback: FocusChangeCallback): void {
    this.onChange = callback;
  }

  /** Call after rendering to update the navigable item counts */
  updateCounts(notificationCount: number, eventCounts: number[]): void {
    this.notificationCount = notificationCount;
    this.eventCounts = eventCounts;

    // Clamp focus if list shrank
    if (this.notificationIndex >= notificationCount) {
      this.notificationIndex = Math.max(0, notificationCount - 1);
      this.inSubItems = false;
      this.eventIndex = -1;
    }
  }

  getState(): FocusState {
    return {
      notificationIndex: this.notificationIndex,
      eventIndex: this.eventIndex,
      inSubItems: this.inSubItems,
    };
  }

  /** Move focus up (previous notification or previous event) */
  moveUp(): void {
    if (this.inSubItems) {
      if (this.eventIndex > 0) {
        this.eventIndex--;
      } else {
        // At first event, exit back to notification header
        this.inSubItems = false;
        this.eventIndex = -1;
      }
    } else {
      if (this.notificationIndex > 0) {
        this.notificationIndex--;
      }
    }
    this.emitChange();
  }

  /** Move focus down (next notification or next event) */
  moveDown(): void {
    if (this.notificationIndex === -1) {
      // Nothing focused yet, focus the first item
      if (this.notificationCount > 0) {
        this.notificationIndex = 0;
      }
    } else if (this.inSubItems) {
      const maxEvent = (this.eventCounts[this.notificationIndex] ?? 1) - 1;
      if (this.eventIndex < maxEvent) {
        this.eventIndex++;
      }
      // At last event, stay (don't auto-exit)
    } else {
      if (this.notificationIndex < this.notificationCount - 1) {
        this.notificationIndex++;
      }
    }
    this.emitChange();
  }

  /** Enter sub-items of the current notification */
  moveRight(): void {
    if (this.notificationIndex === -1) return;
    const eventCount = this.eventCounts[this.notificationIndex] ?? 0;
    if (!this.inSubItems && eventCount > 0) {
      this.inSubItems = true;
      this.eventIndex = 0;
    }
    this.emitChange();
  }

  /** Exit sub-items back to notification level */
  moveLeft(): void {
    if (this.inSubItems) {
      this.inSubItems = false;
      this.eventIndex = -1;
    }
    this.emitChange();
  }

  /** Reset focus (e.g., after list re-render from new data) */
  reset(): void {
    // Keep notificationIndex if valid, reset sub-focus
    if (this.notificationIndex >= this.notificationCount) {
      this.notificationIndex = this.notificationCount > 0 ? 0 : -1;
    }
    this.inSubItems = false;
    this.eventIndex = -1;
    this.emitChange();
  }

  private emitChange(): void {
    this.onChange?.(this.getState());
  }
}
```

#### 5.2.2 Unit Tests for FocusManager

**File**: `tests/mainview/focus.test.ts`

```typescript
import { describe, expect, test } from "bun:test";
import { FocusManager } from "../../src/mainview/focus.js";

describe("FocusManager", () => {
  test("initial state has no focus", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    const state = fm.getState();
    expect(state.notificationIndex).toBe(-1);
    expect(state.eventIndex).toBe(-1);
    expect(state.inSubItems).toBe(false);
  });

  test("moveDown from no focus selects first notification", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown();
    expect(fm.getState().notificationIndex).toBe(0);
  });

  test("moveDown advances through notifications", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveDown(); // 2
    expect(fm.getState().notificationIndex).toBe(2);
  });

  test("moveDown does not go past last notification", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [1, 1]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveDown(); // still 1
    expect(fm.getState().notificationIndex).toBe(1);
  });

  test("moveUp goes back through notifications", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveUp();   // 0
    expect(fm.getState().notificationIndex).toBe(0);
  });

  test("moveUp at first notification stays at 0", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown(); // 0
    fm.moveUp();   // still 0
    expect(fm.getState().notificationIndex).toBe(0);
  });

  test("moveRight enters sub-items", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [3, 1]);
    fm.moveDown();  // notification 0
    fm.moveRight(); // enter sub-items, event 0
    const state = fm.getState();
    expect(state.inSubItems).toBe(true);
    expect(state.eventIndex).toBe(0);
  });

  test("moveRight does nothing if no events", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [0, 1]);
    fm.moveDown();  // notification 0 (0 events)
    fm.moveRight();
    expect(fm.getState().inSubItems).toBe(false);
  });

  test("moveDown in sub-items advances through events", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [3, 1]);
    fm.moveDown();  // notification 0
    fm.moveRight(); // event 0
    fm.moveDown();  // event 1
    fm.moveDown();  // event 2
    expect(fm.getState().eventIndex).toBe(2);
  });

  test("moveDown at last event stays", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [2, 1]);
    fm.moveDown();  // notification 0
    fm.moveRight(); // event 0
    fm.moveDown();  // event 1
    fm.moveDown();  // still event 1
    expect(fm.getState().eventIndex).toBe(1);
  });

  test("moveUp in sub-items goes back to notification header", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [2, 1]);
    fm.moveDown();  // notification 0
    fm.moveRight(); // event 0
    fm.moveUp();    // back to notification header
    const state = fm.getState();
    expect(state.inSubItems).toBe(false);
    expect(state.eventIndex).toBe(-1);
    expect(state.notificationIndex).toBe(0);
  });

  test("moveLeft exits sub-items", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [2, 1]);
    fm.moveDown();  // notification 0
    fm.moveRight(); // event 0
    fm.moveDown();  // event 1
    fm.moveLeft();  // back to notification level
    const state = fm.getState();
    expect(state.inSubItems).toBe(false);
    expect(state.eventIndex).toBe(-1);
    expect(state.notificationIndex).toBe(0);
  });

  test("onChange callback fires on navigation", () => {
    const fm = new FocusManager();
    const states: Array<{ notificationIndex: number }> = [];
    fm.setOnChange((s) => states.push({ notificationIndex: s.notificationIndex }));
    fm.updateCounts(3, [1, 1, 1]);
    fm.moveDown();
    fm.moveDown();
    expect(states).toHaveLength(2);
    expect(states[1]?.notificationIndex).toBe(1);
  });

  test("updateCounts clamps focus when list shrinks", () => {
    const fm = new FocusManager();
    fm.updateCounts(5, [1, 1, 1, 1, 1]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveDown(); // 2
    fm.moveDown(); // 3
    fm.updateCounts(2, [1, 1]);
    expect(fm.getState().notificationIndex).toBe(1);
  });
});
```

### Success Criteria

#### Automated Verification:
- [x] `bun run check` passes
- [x] `bun run typecheck` passes
- [x] `bun test` passes — all FocusManager tests pass

#### Manual Verification:
- [ ] None — FocusManager is pure logic, not wired to DOM yet

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5.3: Wire Keyboard Events + Focus Styles

### Overview

Connect the FocusManager to the notifications tab DOM: listen for `keydown` events, apply visual focus styles, scroll the focused element into view, and handle Enter (open in browser) and Space (mark as done).

### Changes Required

#### 5.3.1 Add Data Attributes to Event Lines

**File**: `src/mainview/index.ts`

Update `renderEventTree` to add `data-event-url` on each event line so the keyboard handler can look up the URL:

```typescript
// In renderEventTree, after creating line element:
if (event.url) {
  line.dataset["eventUrl"] = event.url;
}
```

#### 5.3.2 Wire Keyboard Listener

**File**: `src/mainview/index.ts`

Import `FocusManager` and wire it into the notifications tab. The keyboard handler listens on `document` and dispatches to the focus manager. After focus changes, apply visual styles and optionally show/hide the preview box.

Add to the top of the file:

```typescript
import { FocusManager } from "./focus.js";
```

Add a module-level `FocusManager` instance and `notificationData` cache:

```typescript
const focusManager = new FocusManager();
let currentNotifications: NotificationWithEvents[] = [];
```

Update `renderNotifications` to sync data and focus manager:

```typescript
function renderNotifications(data: NotificationWithEvents[]): void {
  const container = document.getElementById("tab-notifications");
  if (!container) return;

  currentNotifications = data;

  if (data.length === 0) {
    container.innerHTML = '<p class="placeholder">No notifications.</p>';
    focusManager.updateCounts(0, []);
    return;
  }

  container.innerHTML = "";
  const eventCounts: number[] = [];

  for (const notif of data) {
    container.appendChild(renderNotificationBlock(notif));
    eventCounts.push(notif.events.length);
  }

  focusManager.updateCounts(data.length, eventCounts);
  applyFocusStyles();
}
```

#### 5.3.3 Focus Style Application

**File**: `src/mainview/index.ts`

A function that reads the current FocusState and applies/removes CSS classes:

```typescript
function applyFocusStyles(): void {
  const state = focusManager.getState();
  const container = document.getElementById("tab-notifications");
  if (!container) return;

  // Remove all existing focus styles
  for (const el of container.querySelectorAll(".focused")) {
    el.classList.remove("focused");
  }

  if (state.notificationIndex === -1) {
    hidePreviewBox();
    return;
  }

  const blocks = container.querySelectorAll<HTMLElement>(".notification-block");
  const block = blocks[state.notificationIndex];
  if (!block) return;

  if (state.inSubItems) {
    // Focus a specific event line
    const eventLines = block.querySelectorAll<HTMLElement>(".event-line");
    const eventLine = eventLines[state.eventIndex];
    if (eventLine) {
      eventLine.classList.add("focused");
      eventLine.scrollIntoView({ block: "nearest" });
    }
    showPreviewBox(state.notificationIndex);
  } else {
    // Focus the notification block
    block.classList.add("focused");
    block.scrollIntoView({ block: "nearest" });
    hidePreviewBox();
  }
}

focusManager.setOnChange(() => applyFocusStyles());
```

#### 5.3.4 Keyboard Event Handler

**File**: `src/mainview/index.ts`

Register a global `keydown` listener. Only handle keys when the notifications tab is active.

```typescript
function isNotificationsActive(): boolean {
  return document.querySelector('.tab[data-tab="notifications"]')?.classList.contains("active") ?? false;
}

function getActiveTab(): string | null {
  return document.querySelector(".tab.active")?.getAttribute("data-tab") ?? null;
}

function switchToTab(tabName: string): void {
  const tab = document.querySelector<HTMLButtonElement>(`.tab[data-tab="${tabName}"]`);
  tab?.click();
}

document.addEventListener("keydown", (e: KeyboardEvent) => {
  // Tab switching: 1/2/3
  if (e.key === "1") { switchToTab("notifications"); return; }
  if (e.key === "2") { switchToTab("pinned"); return; }
  if (e.key === "3") { switchToTab("activity"); return; }

  // All other keys only work on notifications tab
  if (!isNotificationsActive()) return;

  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      focusManager.moveUp();
      break;
    case "ArrowDown":
      e.preventDefault();
      focusManager.moveDown();
      break;
    case "ArrowRight":
      e.preventDefault();
      focusManager.moveRight();
      break;
    case "ArrowLeft":
      e.preventDefault();
      focusManager.moveLeft();
      break;
    case "Enter":
      e.preventDefault();
      handleEnter();
      break;
    case " ":
      e.preventDefault();
      handleSpace();
      break;
  }
});
```

#### 5.3.5 Enter Handler (Open in Browser)

**File**: `src/mainview/index.ts`

```typescript
function handleEnter(): void {
  const state = focusManager.getState();
  if (state.notificationIndex === -1) return;

  const notif = currentNotifications[state.notificationIndex];
  if (!notif) return;

  if (state.inSubItems) {
    // Open the specific event URL
    const event = notif.events[state.eventIndex];
    const url = event?.url ?? notif.subjectUrl;
    if (url) {
      void rpc.request("openInBrowser", { url, threadId: notif.threadId });
    }
  } else {
    // Open the notification's subject URL
    if (notif.subjectUrl) {
      void rpc.request("openInBrowser", { url: notif.subjectUrl, threadId: notif.threadId });
    }
  }
}
```

#### 5.3.6 Space Handler (Mark as Done)

**File**: `src/mainview/index.ts`

```typescript
function handleSpace(): void {
  const state = focusManager.getState();
  if (state.notificationIndex === -1) return;

  const notif = currentNotifications[state.notificationIndex];
  if (!notif) return;

  // Mark as done — the stateUpdated push will trigger a re-render
  void rpc.request("markDone", { threadId: notif.threadId });
}
```

#### 5.3.7 Focus CSS

**File**: `src/mainview/index.css`

Add focus highlight styles:

```css
/* --- Focus styles --- */

.notification-block.focused {
  background: var(--surface);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.event-line.focused {
  background: var(--surface);
  border-radius: 4px;
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
```

### Success Criteria

#### Automated Verification:
- [x] `bun run check` passes
- [x] `bun run typecheck` passes
- [x] `bun test` passes

#### Manual Verification:
- [ ] Arrow Up/Down moves a visible highlight between notification blocks
- [ ] Arrow Right enters the event tree, highlighting individual event lines
- [ ] Arrow Left exits back to the notification block level
- [ ] Arrow Up at the first event exits back to the notification header
- [ ] Enter opens the correct URL in the system browser
- [ ] Enter on an event line opens the event's URL (or falls back to notification URL)
- [ ] Space dismisses the focused notification (it disappears from the list)
- [ ] After dismissal, focus moves to a valid position
- [ ] 1/2/3 keys switch tabs
- [ ] Focused item scrolls into view when navigating

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5.4: Floating Preview Box

### Overview

When the user navigates into a notification's sub-events (Right arrow), show a floating preview box in the top-right corner of the content area. The preview shows the parent notification's type icon, title, repository, and description summary, giving context while scrolling through events.

### Changes Required

#### 5.4.1 Preview Box HTML

**File**: `src/mainview/index.html`

Add a preview box element inside `<main id="content">`:

```html
<main id="content">
  <div id="preview-box" class="preview-box hidden"></div>
  <!-- existing sections -->
</main>
```

#### 5.4.2 Preview Box Rendering

**File**: `src/mainview/index.ts`

Implement `showPreviewBox` and `hidePreviewBox`:

```typescript
function showPreviewBox(notificationIndex: number): void {
  const box = document.getElementById("preview-box");
  if (!box) return;

  const notif = currentNotifications[notificationIndex];
  if (!notif) {
    hidePreviewBox();
    return;
  }

  let summaryHtml = "";
  if (notif.descriptionSummary) {
    summaryHtml = `<div class="preview-summary">✨ ${escapeHtml(notif.descriptionSummary)}</div>`;
  }

  box.innerHTML = `
    <div class="preview-header">
      <span class="notification-icon">${subjectTypeIcon(notif.subjectType)}</span>
      <span class="preview-title">${escapeHtml(notif.subjectTitle)}</span>
    </div>
    <div class="preview-repo">${escapeHtml(notif.repository)}</div>
    ${summaryHtml}
  `;
  box.classList.remove("hidden");
}

function hidePreviewBox(): void {
  const box = document.getElementById("preview-box");
  if (box) {
    box.classList.add("hidden");
  }
}
```

#### 5.4.3 Preview Box CSS

**File**: `src/mainview/index.css`

```css
/* --- Preview Box --- */

.preview-box {
  position: fixed;
  top: calc(var(--titlebar-height) + 12px);
  right: 16px;
  width: 280px;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 12px;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.preview-box.hidden {
  display: none;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.preview-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-repo {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.preview-summary {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}
```

### Success Criteria

#### Automated Verification:
- [x] `bun run check` passes
- [x] `bun run typecheck` passes
- [x] `bun test` passes

#### Manual Verification:
- [ ] Pressing Right on a notification shows the preview box in the top-right corner
- [ ] Preview box shows the notification's icon, title, repository, and description summary
- [ ] Pressing Left to exit sub-items hides the preview box
- [ ] Preview box does not overlap the titlebar
- [ ] Preview box has a visible border and shadow distinguishing it from content

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Testing Strategy

### Unit Tests (new)

**File**: `tests/mainview/focus.test.ts`
- All FocusManager navigation cases (described in Phase 5.2.2):
  - Initial state, moveDown from nothing, moveDown through list
  - moveUp through list, boundaries
  - moveRight into sub-items, moveLeft out
  - moveUp from first event exits to notification header
  - moveDown at last event stays
  - Callback firing
  - Count clamping on list shrink
  - moveRight with 0 events does nothing

### Integration Tests

No new integration tests — keyboard navigation is a WebView concern that Electrobun handles. The FocusManager is thoroughly unit-tested as a pure state machine. RPC handler wiring is covered by existing tests.

### What's NOT Tested

- DOM focus styling (manual verification)
- Keyboard event propagation in WebKit WebView (manual verification)
- `openExternal` actually opening the browser (Electrobun responsibility)
- Preview box positioning and layout (manual verification)

## Performance Considerations

- Focus style application is O(n) where n is the number of notification blocks (queries all `.focused` elements). With typical notification counts (<100), this is negligible.
- `scrollIntoView({ block: "nearest" })` is native and efficient.
- No re-render on focus change — only CSS class toggling.

## References

- Design spec: `docs/design.md:91` (keyboard navigation behavior), `docs/design.md:169` (Phase 5 milestone)
- Phase 3 plan: `docs/plans/2026-03-10-phase-3-gui-core.md` (deferred openInBrowser at line 42)
- Phase 4 plan: `docs/plans/2026-03-10-phase-4-llm-integration.md`
- Electrobun `openExternal`: `node_modules/electrobun/dist/api/bun/core/Utils.ts:33`
- GitHub `markThreadAsRead`: `src/github/client.ts:31,83`
- Current mainview: `src/mainview/index.ts`
