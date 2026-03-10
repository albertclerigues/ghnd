import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import type {
  ActivityRow,
  NotificationEventRow,
  NotificationRow,
  PinnedRow,
  SyncMetaRow,
} from "../../src/db/types.js";

describe("notifications CRUD", () => {
  it("inserts and retrieves a notification", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Bug report', 'mention', '2026-03-10T00:00:00Z')`,
    );

    const row = db
      .query<NotificationRow, [string]>("SELECT * FROM notifications WHERE thread_id = ?1")
      .get("t1");

    expect(row).not.toBeNull();
    expect(row?.repository).toBe("owner/repo");
    expect(row?.subject_title).toBe("Bug report");
    expect(row?.unread).toBe(1);
    expect(row?.dismissed_at).toBeNull();

    db.close();
  });

  it("updates notification read status", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Bug', 'mention', '2026-03-10T00:00:00Z')`,
    );

    db.run("UPDATE notifications SET unread = 0 WHERE thread_id = 't1'");

    const row = db
      .query<NotificationRow, [string]>("SELECT * FROM notifications WHERE thread_id = ?1")
      .get("t1");

    expect(row?.unread).toBe(0);

    db.close();
  });
});

describe("notification_events CRUD", () => {
  it("inserts events linked to a notification", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Bug', 'mention', '2026-03-10T00:00:00Z')`,
    );

    db.run(
      `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, body, summary, event_timestamp)
       VALUES ('t1', 'e1', 'comment', 'alice', 'This is a long comment...', 'Alice commented on the bug', '2026-03-10T01:00:00Z')`,
    );

    const events = db
      .query<NotificationEventRow, [string]>(
        "SELECT * FROM notification_events WHERE notification_thread_id = ?1 ORDER BY event_timestamp",
      )
      .all("t1");

    expect(events.length).toBe(1);
    expect(events[0]?.actor).toBe("alice");
    expect(events[0]?.summary).toBe("Alice commented on the bug");

    db.close();
  });
});

describe("pinned CRUD", () => {
  it("inserts a pinned item with group and sort order", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO pinned (subject_type, subject_title, subject_url, repository, group_name, sort_order)
       VALUES ('PullRequest', 'Add feature X', 'https://github.com/owner/repo/pull/1', 'owner/repo', 'In Progress', 1)`,
    );

    const pins = db
      .query<PinnedRow, [string]>("SELECT * FROM pinned WHERE group_name = ?1 ORDER BY sort_order")
      .all("In Progress");

    expect(pins.length).toBe(1);
    expect(pins[0]?.subject_title).toBe("Add feature X");
    expect(pins[0]?.sort_order).toBe(1);

    db.close();
  });
});

describe("activity CRUD", () => {
  it("inserts and queries activity events", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO activity (event_id, event_type, repository, action, target_title, target_url, event_timestamp)
       VALUES ('a1', 'PushEvent', 'owner/repo', 'committed', 'Fix typo', 'https://github.com/owner/repo/commit/abc', '2026-03-10T00:00:00Z')`,
    );

    const rows = db
      .query<ActivityRow, []>("SELECT * FROM activity ORDER BY event_timestamp DESC")
      .all();

    expect(rows.length).toBe(1);
    expect(rows[0]?.action).toBe("committed");

    db.close();
  });
});

describe("sync_meta CRUD", () => {
  it("stores and retrieves sync metadata", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO sync_meta (key, value) VALUES ('notifications_last_poll', '2026-03-10T00:00:00Z')`,
    );

    const row = db
      .query<SyncMetaRow, [string]>("SELECT * FROM sync_meta WHERE key = ?1")
      .get("notifications_last_poll");

    expect(row?.value).toBe("2026-03-10T00:00:00Z");

    db.close();
  });

  it("upserts sync metadata", () => {
    const db = createMemoryDatabase();

    db.run(`INSERT INTO sync_meta (key, value) VALUES ('last_poll', '2026-03-09T00:00:00Z')`);
    db.run(
      `INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES ('last_poll', '2026-03-10T00:00:00Z', datetime('now'))`,
    );

    const row = db
      .query<SyncMetaRow, [string]>("SELECT * FROM sync_meta WHERE key = ?1")
      .get("last_poll");

    expect(row?.value).toBe("2026-03-10T00:00:00Z");

    db.close();
  });
});
