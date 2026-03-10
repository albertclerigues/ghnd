import type { GHDDatabase } from "../db/queries.js";
import { activityId } from "../db/types.js";
import { normalizeUserEvent } from "../github/activity.js";
import type { GitHubClient } from "../github/client.js";

const SYNC_KEY = "activity_last_poll";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PRUNE_DAYS = 30;

export interface ActivityPollerOptions {
  intervalMs?: number;
  pruneDays?: number;
  onSync?: () => void;
}

export class ActivityPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly pruneDays: number;
  private readonly onSync: (() => void) | undefined;

  constructor(
    private readonly db: GHDDatabase,
    private readonly github: GitHubClient,
    private readonly username: string,
    options?: ActivityPollerOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.pruneDays = options?.pruneDays ?? PRUNE_DAYS;
    this.onSync = options?.onSync;
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
          body: normalized.body,
          eventTimestamp: event.created_at,
        });
        processed++;
      }

      // Prune old activity
      this.db.pruneActivity(this.pruneDays);

      // Update last poll timestamp
      this.db.setSyncMeta(SYNC_KEY, new Date().toISOString());

      this.onSync?.();

      return { processed };
    } catch (err) {
      console.error("[ghd] Activity poll failed:", err);
      return { processed: 0 };
    } finally {
      this.running = false;
    }
  }
}
