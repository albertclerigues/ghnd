export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create_notifications",
    sql: `
      CREATE TABLE notifications (
        thread_id          TEXT    PRIMARY KEY,
        repository         TEXT    NOT NULL,
        subject_type       TEXT    NOT NULL,
        subject_title      TEXT    NOT NULL,
        subject_url        TEXT,
        reason             TEXT    NOT NULL,
        unread             INTEGER NOT NULL DEFAULT 1,
        github_updated_at  TEXT    NOT NULL,
        github_last_read_at TEXT,
        dismissed_at       TEXT,
        created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_notifications_repository ON notifications(repository);
      CREATE INDEX idx_notifications_unread ON notifications(unread);
      CREATE INDEX idx_notifications_updated ON notifications(github_updated_at);
    `,
  },
  {
    version: 2,
    name: "create_notification_events",
    sql: `
      CREATE TABLE notification_events (
        notification_thread_id TEXT NOT NULL,
        event_id               TEXT NOT NULL,
        event_type             TEXT NOT NULL,
        actor                  TEXT NOT NULL,
        body                   TEXT,
        summary                TEXT,
        url                    TEXT,
        event_timestamp        TEXT NOT NULL,
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (notification_thread_id, event_id),
        FOREIGN KEY (notification_thread_id)
          REFERENCES notifications(thread_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_events_timestamp ON notification_events(event_timestamp);
    `,
  },
  {
    version: 3,
    name: "create_pinned",
    sql: `
      CREATE TABLE pinned (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_thread_id  TEXT,
        subject_type            TEXT    NOT NULL,
        subject_title           TEXT    NOT NULL,
        subject_url             TEXT    NOT NULL,
        repository              TEXT    NOT NULL,
        group_name              TEXT    NOT NULL DEFAULT 'Default',
        sort_order              INTEGER NOT NULL DEFAULT 0,
        created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (notification_thread_id)
          REFERENCES notifications(thread_id) ON DELETE SET NULL
      );

      CREATE INDEX idx_pinned_group ON pinned(group_name, sort_order);
    `,
  },
  {
    version: 4,
    name: "create_activity",
    sql: `
      CREATE TABLE activity (
        event_id        TEXT PRIMARY KEY,
        event_type      TEXT NOT NULL,
        repository      TEXT NOT NULL,
        action          TEXT NOT NULL,
        target_title    TEXT NOT NULL,
        target_url      TEXT,
        event_timestamp TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_activity_timestamp ON activity(event_timestamp);
      CREATE INDEX idx_activity_repository ON activity(repository);
    `,
  },
  {
    version: 5,
    name: "create_sync_meta",
    sql: `
      CREATE TABLE sync_meta (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
] as const;
