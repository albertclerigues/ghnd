import type { GHDDatabase } from "../db/queries.js";
import type { EventId, ThreadId } from "../db/types.js";
import { eventId, threadId } from "../db/types.js";
import type { GitHubClient } from "../github/client.js";
import { extractActor, extractEventId, extractTimestamp, mapEventType } from "../github/events.js";
import { apiUrlToHtmlUrl, parseSubjectUrl } from "../github/urls.js";
import type { Summarizer } from "../summarizer/types.js";

const SYNC_KEY = "notifications_last_poll";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface NotificationPollerOptions {
  intervalMs?: number | undefined;
  onSync?: (() => void) | undefined;
  summarizer?: Summarizer | undefined;
}

export class NotificationPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly onSync: (() => void) | undefined;
  private readonly summarizer: Summarizer | undefined;

  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    options?: NotificationPollerOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.onSync = options?.onSync;
    this.summarizer = options?.summarizer;
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
    tid: ThreadId,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<void> {
    const events = await this.github.getTimelineEvents(owner, repo, issueNumber);

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
        summary: null,
        url: event.html_url ?? null,
        eventTimestamp: extractTimestamp(event),
      });

      if (mappedType === "comment" && body) {
        commentEvents.push({ eventId: eid, body });
      }
    }

    if (this.summarizer) {
      void this.summarizeThread(tid, owner, repo, issueNumber, commentEvents);
    }
  }

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

      // biome-ignore lint/style/noNonNullAssertion: summarizer is checked before calling this method
      const result = await this.summarizer!.summarize(content);

      this.db.updateDescriptionSummary(tid, result.descriptionSummary);

      for (const commentSummary of result.comments) {
        const idx = commentSummary.commentNumber - 1;
        const event = commentEvents[idx];
        if (event) {
          this.db.updateEventSummary(tid, event.eventId, commentSummary.summary);
        }
      }

      this.onSync?.();
    } catch (err) {
      console.error(`[ghd] Summarization failed for thread ${String(tid)}:`, err);
    }
  }
}
