import type { GHDDatabase } from "../db/queries.js";
import { eventId, threadId } from "../db/types.js";
import type { GitHubClient } from "../github/client.js";
import { extractActor, extractEventId, extractTimestamp, mapEventType } from "../github/events.js";
import { apiUrlToHtmlUrl, parseSubjectUrl } from "../github/urls.js";

const SYNC_KEY = "notifications_last_poll";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface NotificationPollerOptions {
  intervalMs?: number;
  onSync?: () => void;
}

export class NotificationPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly onSync: (() => void) | undefined;

  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    options?: NotificationPollerOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.onSync = options?.onSync;
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
      const notifications = await this.github.listNotifications(since ? { since } : undefined);

      let processed = 0;

      for (const notification of notifications) {
        try {
          await this.processNotification(notification);
          processed++;
        } catch (err) {
          console.error(`[ghd] Failed to process notification ${notification.id}:`, err);
        }
      }

      // Update last poll timestamp
      this.db.setSyncMeta(SYNC_KEY, new Date().toISOString());

      this.onSync?.();

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
    const subjectUrl = notification.subject.url ? apiUrlToHtmlUrl(notification.subject.url) : null;

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
