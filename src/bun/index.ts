import { BrowserView, BrowserWindow, Utils } from "electrobun";
import { createDatabase } from "../db/client.js";
import { GHDDatabase } from "../db/queries.js";
import type { ThreadId } from "../db/types.js";
import { pinId, threadId } from "../db/types.js";
import { FetchGitHubClient } from "../github/client.js";
import { resolveGitHubToken, resolveGitHubUsername } from "../github/token.js";
import { ActivityPoller } from "../poller/activity.js";
import { NotificationPoller } from "../poller/notifications.js";
import type {
  ActivityData,
  GHDRpcSchema,
  NotificationWithEvents,
  PinnedGroupData,
} from "../shared/rpc.js";
import { ClaudeCliSummarizer } from "../summarizer/claude-cli.js";

// Initialize the database
const rawDb = createDatabase();
const db = new GHDDatabase(rawDb);

// Module-level GitHub client reference (assigned after async init)
let githubClient: FetchGitHubClient | undefined;

// Define RPC handlers
// Electrobun's RPCRequestHandler intersection with BaseRPCRequestsSchema
// creates an index signature that can't be satisfied by a concrete handler object.
// The cast is safe because all required methods are implemented below.
const rpc = BrowserView.defineRPC<GHDRpcSchema>({
  maxRequestTime: 5000,
  handlers: {
    // @ts-expect-error Electrobun RPCRequestHandlerObject index signature incompatibility
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
          descriptionSummary: n.description_summary,
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
        // Also mark as read on GitHub (fire-and-forget)
        void githubClient?.markThreadAsRead(tid).catch((err) => {
          console.error("[ghd] Failed to mark thread as read:", err);
        });
        win.webview.rpc?.send("stateUpdated", { scope: "notifications" });
        return undefined;
      },

      pinItem: (params) => {
        const pinInput: {
          subjectType: string;
          subjectTitle: string;
          subjectUrl: string;
          repository: string;
          groupName?: string;
          notificationThreadId?: ThreadId | null;
        } = {
          subjectType: params.subjectType,
          subjectTitle: params.subjectTitle,
          subjectUrl: params.subjectUrl,
          repository: params.repository,
        };
        if (params.groupName !== undefined) {
          pinInput.groupName = params.groupName;
        }
        if (params.notificationThreadId !== undefined) {
          pinInput.notificationThreadId = threadId(params.notificationThreadId);
        }
        const id = db.pinItem(pinInput);
        win.webview.rpc?.send("stateUpdated", { scope: "pinned" });
        return { id: id as number };
      },

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

      unpinItem: ({ id }) => {
        db.unpinItem(pinId(id));
        win.webview.rpc?.send("stateUpdated", { scope: "pinned" });
        return undefined;
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
    githubClient = github;
    const username = await resolveGitHubUsername(token);

    const summarizer = new ClaudeCliSummarizer();

    const notificationPoller = new NotificationPoller(db, github, {
      summarizer,
      onSync: () => {
        win.webview.rpc?.send("stateUpdated", { scope: "notifications" });
      },
    });
    const activityPoller = new ActivityPoller(db, github, username, {
      onSync: () => {
        win.webview.rpc?.send("stateUpdated", { scope: "activity" });
      },
    });

    notificationPoller.start();
    activityPoller.start();

    console.log(`[ghd] Pollers started for user: ${username}`);
  } catch (err) {
    console.error("[ghd] Failed to start pollers:", err);
  }
})();
