import { Electroview } from "electrobun/view";
import type {
  ActivityData,
  GHDRpcSchema,
  NotificationWithEvents,
  PinnedGroupData,
} from "../shared/rpc.js";
import { actionColor, eventTypeLabel, relativeTime, subjectTypeIcon } from "./format.js";

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

  if (notif.events.length > 0) {
    block.appendChild(renderEventTree(notif.events));
  }

  return block;
}

function renderEventTree(events: NotificationWithEvents["events"]): HTMLDivElement {
  const tree = document.createElement("div");
  tree.className = "event-tree";

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;
    const isLast = i === events.length - 1;
    const connector = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";

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

  return tree;
}

function renderNotifications(data: NotificationWithEvents[]): void {
  const container = document.getElementById("tab-notifications");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = '<p class="placeholder">No notifications.</p>';
    return;
  }

  container.innerHTML = "";

  for (const notif of data) {
    container.appendChild(renderNotificationBlock(notif));
  }
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

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  void refreshNotifications();
  void refreshPinned();
  void refreshActivity();
});
