import { Electroview } from "electrobun/view";
import type {
  ActivityData,
  GHDRpcSchema,
  NotificationWithEvents,
  PinnedGroupData,
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

// --- Rendering (stub implementations, completed in Phase 3.3 and 3.4) ---

function renderNotifications(_data: NotificationWithEvents[]): void {
  // Phase 3.3
}

function renderPinned(_data: PinnedGroupData[]): void {
  // Phase 3.4
}

function renderActivity(_data: ActivityData[]): void {
  // Phase 3.4
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  void refreshNotifications();
});
