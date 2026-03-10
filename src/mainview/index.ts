import { Electroview } from "electrobun/view";
import type {
  ActivityData,
  GHDRpcSchema,
  NotificationEventData,
  NotificationWithEvents,
  PinnedGroupData,
} from "../shared/rpc.js";
import { FocusManager } from "./focus.js";
import { actionColor, eventTypeLabel, relativeTime, subjectTypeIcon } from "./format.js";
import { renderMarkdown } from "./markdown.js";

// --- Event Compaction ---

interface CompactedEvent {
  eventType: string;
  actor: string;
  /** Compacted description (e.g., "assigned @user1, @user2; unassigned @user3") */
  label: string;
  eventTimestamp: string;
  url: string | null;
  summary: string | null;
  /** Original event body (from first event in group, for sidebar) */
  body: string | null;
  /** Source event indices in the original array */
  sourceIndices: number[];
}

const COMPACTABLE_TYPES = new Set(["assignment", "label"]);

function toSingleCompactedEvent(event: NotificationEventData, index: number): CompactedEvent {
  return {
    eventType: event.eventType,
    actor: event.actor,
    label: eventTypeLabel(event.eventType),
    eventTimestamp: event.eventTimestamp,
    url: event.url,
    summary: event.summary,
    body: event.body,
    sourceIndices: [index],
  };
}

function compactGroup(
  first: NotificationEventData,
  group: Array<{ event: NotificationEventData; index: number }>,
): CompactedEvent {
  const bodies = group.map((g) => g.event.body).filter((b): b is string => b !== null);
  return {
    eventType: first.eventType,
    actor: first.actor,
    label: bodies.length > 0 ? bodies.join(", ") : eventTypeLabel(first.eventType),
    eventTimestamp: first.eventTimestamp,
    url: first.url,
    summary: first.summary,
    body: bodies.join("; "),
    sourceIndices: group.map((g) => g.index),
  };
}

function collectAdjacentGroup(
  events: NotificationEventData[],
  startIndex: number,
  eventType: string,
  actor: string,
): { group: Array<{ event: NotificationEventData; index: number }>; nextIndex: number } {
  const group: Array<{ event: NotificationEventData; index: number }> = [];
  let i = startIndex;
  while (i < events.length) {
    const next = events[i];
    if (!next || next.eventType !== eventType || next.actor !== actor) break;
    group.push({ event: next, index: i });
    i++;
  }
  return { group, nextIndex: i };
}

function compactEvents(events: NotificationEventData[]): CompactedEvent[] {
  const result: CompactedEvent[] = [];
  let i = 0;

  while (i < events.length) {
    const event = events[i];
    if (!event) {
      i++;
      continue;
    }

    if (!COMPACTABLE_TYPES.has(event.eventType)) {
      result.push(toSingleCompactedEvent(event, i));
      i++;
      continue;
    }

    const { group, nextIndex } = collectAdjacentGroup(events, i, event.eventType, event.actor);
    result.push(compactGroup(event, group));
    i = nextIndex;
  }

  return result;
}

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

const _view = new Electroview({ rpc });

// --- Focus Management ---

const focusManager = new FocusManager();
let currentNotifications: NotificationWithEvents[] = [];
let currentCompactedEvents: CompactedEvent[][] = [];

// Activity focus state (simple index-based, no FocusManager needed)
let currentActivityData: ActivityData[] = [];
let activityFocusIndex = -1;

// --- Tab Management ---

type TabName = "notifications" | "pinned" | "activity";

function getActiveTab(): TabName {
  const active = document.querySelector<HTMLButtonElement>(".tab.active");
  return (active?.dataset["tab"] as TabName) ?? "notifications";
}

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

      // Hide sidebar when switching tabs — each tab manages its own sidebar
      hideSidebar();
      activityFocusIndex = -1;

      void refreshTab(target as TabName);
    });
  }
}

// --- Data Fetching & Rendering ---

async function refreshTab(scope: TabName): Promise<void> {
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

// --- Renderers ---

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

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

  if (notif.descriptionSummary) {
    const summaryLine = document.createElement("div");
    summaryLine.className = "notification-summary";
    summaryLine.innerHTML = `\u2728 ${escapeHtml(notif.descriptionSummary)}`;
    block.appendChild(summaryLine);
  }

  const compacted = compactEvents(notif.events);
  if (compacted.length > 0) {
    block.appendChild(renderEventTree(compacted));
  }

  return block;
}

function renderEventTree(compacted: CompactedEvent[]): HTMLDivElement {
  const tree = document.createElement("div");
  tree.className = "event-tree";

  for (let i = 0; i < compacted.length; i++) {
    const event = compacted[i];
    if (!event) continue;
    const isLast = i === compacted.length - 1;
    const connector = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";

    const line = document.createElement("div");
    line.className = "event-line";
    if (event.url) {
      line.dataset["eventUrl"] = event.url;
    }

    let summaryHtml = "";
    if (event.summary) {
      summaryHtml = ` <span class="event-summary">\u2728 ${escapeHtml(event.summary)}</span>`;
    }

    line.innerHTML = `
      <span class="tree-connector">${connector}</span>
      <span class="event-type">${escapeHtml(event.label)}</span>
      <span class="event-actor">${escapeHtml(event.actor)}</span>
      <span class="event-time">${relativeTime(event.eventTimestamp)}</span>
      ${summaryHtml}
    `;
    tree.appendChild(line);
  }

  return tree;
}

function renderNotifications(data: NotificationWithEvents[]): void {
  const container = document.getElementById("tab-notifications");
  if (!container) return;

  currentNotifications = data;
  currentCompactedEvents = data.map((notif) => compactEvents(notif.events));

  if (data.length === 0) {
    container.innerHTML = '<p class="placeholder">No notifications.</p>';
    focusManager.updateCounts(0, []);
    return;
  }

  container.innerHTML = "";
  const eventCounts: number[] = [];

  for (let idx = 0; idx < data.length; idx++) {
    const notif = data[idx];
    if (!notif) continue;
    container.appendChild(renderNotificationBlock(notif));
    eventCounts.push(currentCompactedEvents[idx]?.length ?? 0);
  }

  focusManager.updateCounts(data.length, eventCounts);
  applyFocusStyles();
}

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

function renderActivity(data: ActivityData[]): void {
  const container = document.getElementById("tab-activity");
  if (!container) return;

  currentActivityData = data;
  activityFocusIndex = -1;

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

// --- Focus Styles ---

function applyFocusStyles(): void {
  const state = focusManager.getState();
  const container = document.getElementById("tab-notifications");
  if (!container) return;

  // Remove all existing focus styles
  for (const el of container.querySelectorAll(".focused")) {
    el.classList.remove("focused");
  }

  if (state.notificationIndex === -1) {
    hideSidebar();
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
    showSidebar(state.notificationIndex, state.eventIndex);
  } else {
    // Focus the notification block
    block.classList.add("focused");
    block.scrollIntoView({ block: "nearest" });
    showSidebar(state.notificationIndex, -1);
  }
}

focusManager.setOnChange(() => applyFocusStyles());

// --- Activity Focus ---

function applyActivityFocusStyles(): void {
  const container = document.getElementById("tab-activity");
  if (!container) return;

  // Remove existing focus
  for (const el of container.querySelectorAll(".focused")) {
    el.classList.remove("focused");
  }

  if (activityFocusIndex === -1) {
    hideSidebar();
    return;
  }

  const rows = container.querySelectorAll<HTMLElement>(".activity-table tbody tr");
  const row = rows[activityFocusIndex];
  if (!row) return;

  row.classList.add("focused");
  row.scrollIntoView({ block: "nearest" });

  const item = currentActivityData[activityFocusIndex];
  if (item) {
    showActivitySidebar(item);
  }
}

// --- Sidebar ---

function renderEventSidebar(
  notif: NotificationWithEvents,
  notifIndex: number,
  eventIndex: number,
): string {
  const compacted = currentCompactedEvents[notifIndex];
  const event = compacted?.[eventIndex];
  if (!event) return "";

  const bodyHtml = event.body
    ? renderMarkdown(event.body)
    : event.summary
      ? `<p>${escapeHtml(event.summary)}</p>`
      : "<p>No content.</p>";

  return `
    <div class="sidebar-meta-title">${escapeHtml(notif.subjectTitle)}</div>
    <div class="sidebar-meta-repo">${escapeHtml(notif.repository)}</div>
    <div class="sidebar-meta-detail">${escapeHtml(event.label)} by ${escapeHtml(event.actor)} ${relativeTime(event.eventTimestamp)}</div>
    <hr class="sidebar-divider">
    <div class="sidebar-body">${bodyHtml}</div>
  `;
}

function renderNotificationSidebar(notif: NotificationWithEvents): string {
  let bodyHtml: string;
  if (notif.descriptionBody) {
    bodyHtml = renderMarkdown(notif.descriptionBody);
  } else if (notif.descriptionSummary) {
    bodyHtml = renderMarkdown(notif.descriptionSummary);
  } else {
    bodyHtml = "<p>No description.</p>";
  }

  const summaryLine = notif.descriptionSummary
    ? `<div class="sidebar-meta-detail">\u2728 ${escapeHtml(notif.descriptionSummary)}</div>`
    : "";

  return `
    <div class="sidebar-meta-title">${subjectTypeIcon(notif.subjectType)} ${escapeHtml(notif.subjectTitle)}</div>
    <div class="sidebar-meta-repo">${escapeHtml(notif.repository)}</div>
    <div class="sidebar-meta-detail">${escapeHtml(notif.subjectType)} \u00b7 ${escapeHtml(notif.reason)} \u00b7 ${relativeTime(notif.githubUpdatedAt)}</div>
    ${summaryLine}
    <hr class="sidebar-divider">
    <div class="sidebar-body">${bodyHtml}</div>
  `;
}

function renderActivitySidebar(item: ActivityData): string {
  const bodyHtml = item.body ? renderMarkdown(item.body) : "";
  const bodySection = bodyHtml
    ? `<hr class="sidebar-divider"><div class="sidebar-body">${bodyHtml}</div>`
    : "";

  return `
    <div class="sidebar-meta-title">
      <span class="action-badge" style="background: ${actionColor(item.action)}">${escapeHtml(item.action)}</span>
      ${escapeHtml(item.targetTitle)}
    </div>
    <div class="sidebar-meta-repo">${escapeHtml(item.repository)}</div>
    <div class="sidebar-meta-detail">${escapeHtml(item.eventType)} \u00b7 ${relativeTime(item.eventTimestamp)}</div>
    ${item.targetUrl ? `<div class="sidebar-meta-detail"><a href="#">${escapeHtml(item.targetUrl)}</a></div>` : ""}
    ${bodySection}
  `;
}

function showSidebar(notificationIndex: number, eventIndex: number): void {
  const sidebar = document.getElementById("sidebar");
  const content = document.getElementById("sidebar-content");
  if (!sidebar || !content) return;

  const notif = currentNotifications[notificationIndex];
  if (!notif) {
    hideSidebar();
    return;
  }

  const html =
    eventIndex >= 0
      ? renderEventSidebar(notif, notificationIndex, eventIndex)
      : renderNotificationSidebar(notif);

  if (!html) {
    hideSidebar();
    return;
  }

  content.innerHTML = html;
  sidebar.classList.remove("hidden");
}

function showActivitySidebar(item: ActivityData): void {
  const sidebar = document.getElementById("sidebar");
  const content = document.getElementById("sidebar-content");
  if (!sidebar || !content) return;

  content.innerHTML = renderActivitySidebar(item);
  sidebar.classList.remove("hidden");
}

function hideSidebar(): void {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.classList.add("hidden");
  }
}

// --- Keyboard Navigation ---

function isNotificationsActive(): boolean {
  return getActiveTab() === "notifications";
}

function isActivityActive(): boolean {
  return getActiveTab() === "activity";
}

function switchToTab(tabName: string): void {
  const tab = document.querySelector<HTMLButtonElement>(`.tab[data-tab="${tabName}"]`);
  tab?.click();
}

function handleEnter(): void {
  const state = focusManager.getState();
  if (state.notificationIndex === -1) return;

  const notif = currentNotifications[state.notificationIndex];
  if (!notif) return;

  if (state.inSubItems) {
    // Open the specific event URL
    const compacted = currentCompactedEvents[state.notificationIndex];
    const event = compacted?.[state.eventIndex];
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

function handleActivityEnter(): void {
  if (activityFocusIndex === -1) return;
  const item = currentActivityData[activityFocusIndex];
  if (item?.targetUrl) {
    void rpc.request("openInBrowser", { url: item.targetUrl });
  }
}

function pinNotification(): void {
  const state = focusManager.getState();
  if (state.notificationIndex === -1) return;

  const notif = currentNotifications[state.notificationIndex];
  if (!notif) return;

  if (state.inSubItems) {
    pinNotificationEvent(notif, state.notificationIndex, state.eventIndex);
  } else {
    pinNotificationItem(notif);
  }
}

function pinNotificationEvent(
  notif: NotificationWithEvents,
  notifIndex: number,
  eventIndex: number,
): void {
  const compacted = currentCompactedEvents[notifIndex];
  const event = compacted?.[eventIndex];
  if (!event) return;

  const url = event.url ?? notif.subjectUrl;
  if (!url) return;

  void rpc.request("pinItem", {
    subjectType: event.eventType,
    subjectTitle: `${event.label} — ${notif.subjectTitle}`,
    subjectUrl: url,
    repository: notif.repository,
    notificationThreadId: notif.threadId,
  });
}

function pinNotificationItem(notif: NotificationWithEvents): void {
  if (!notif.subjectUrl) return;

  void rpc.request("pinItem", {
    subjectType: notif.subjectType,
    subjectTitle: notif.subjectTitle,
    subjectUrl: notif.subjectUrl,
    repository: notif.repository,
    notificationThreadId: notif.threadId,
  });
}

function pinActivityItem(): void {
  if (activityFocusIndex === -1) return;
  const item = currentActivityData[activityFocusIndex];
  if (!item?.targetUrl) return;

  void rpc.request("pinItem", {
    subjectType: item.eventType,
    subjectTitle: item.targetTitle,
    subjectUrl: item.targetUrl,
    repository: item.repository,
  });
}

function handlePin(): void {
  const activeTab = getActiveTab();
  if (activeTab === "notifications") {
    pinNotification();
  } else if (activeTab === "activity") {
    pinActivityItem();
  }
}

function handleSpace(): void {
  const state = focusManager.getState();
  if (state.notificationIndex === -1) return;

  const notif = currentNotifications[state.notificationIndex];
  if (!notif) return;

  // Mark as done — the stateUpdated push will trigger a re-render
  void rpc.request("markDone", { threadId: notif.threadId });
}

function handleActivityKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      if (activityFocusIndex > 0) activityFocusIndex--;
      applyActivityFocusStyles();
      break;
    case "ArrowDown":
      e.preventDefault();
      if (activityFocusIndex === -1) {
        if (currentActivityData.length > 0) activityFocusIndex = 0;
      } else if (activityFocusIndex < currentActivityData.length - 1) {
        activityFocusIndex++;
      }
      applyActivityFocusStyles();
      break;
    case "Enter":
      e.preventDefault();
      handleActivityEnter();
      break;
  }
}

function handleNotificationsKeydown(e: KeyboardEvent): void {
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
}

const TAB_KEYS: Record<string, string> = { "1": "notifications", "2": "pinned", "3": "activity" };

document.addEventListener("keydown", (e: KeyboardEvent) => {
  // Cmd+D to pin focused item (works across tabs)
  if (e.metaKey && e.key === "d") {
    e.preventDefault();
    handlePin();
    return;
  }

  const tabTarget = TAB_KEYS[e.key];
  if (tabTarget) {
    switchToTab(tabTarget);
    return;
  }

  if (isActivityActive()) {
    handleActivityKeydown(e);
  } else if (isNotificationsActive()) {
    handleNotificationsKeydown(e);
  }
});

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  void refreshNotifications();
  void refreshPinned();
  void refreshActivity();
});
