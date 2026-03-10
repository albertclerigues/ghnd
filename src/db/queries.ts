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
      .query<ActivityRow, [number]>("SELECT * FROM activity ORDER BY event_timestamp DESC LIMIT ?1")
      .all(limit);
  }

  pruneActivity(daysToKeep: number): number {
    const result = this.db.run("DELETE FROM activity WHERE event_timestamp < datetime('now', ?1)", [
      `-${String(daysToKeep)} days`,
    ]);
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
