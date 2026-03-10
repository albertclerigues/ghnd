import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import { getMigrationStatus, runMigrations } from "../../src/db/migrations.js";
import { MIGRATIONS } from "../../src/db/schema.js";

describe("migrations", () => {
  it("applies all migrations to a fresh database", () => {
    const db = createMemoryDatabase();
    const status = getMigrationStatus(db);

    expect(status.applied.length).toBe(MIGRATIONS.length);
    expect(status.pending.length).toBe(0);

    db.close();
  });

  it("is idempotent — running twice applies nothing the second time", () => {
    const db = createMemoryDatabase();
    const result = runMigrations(db);

    expect(result.applied).toBe(0);

    db.close();
  });

  it("creates all expected tables", () => {
    const db = createMemoryDatabase();
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain("notifications");
    expect(tables).toContain("notification_events");
    expect(tables).toContain("pinned");
    expect(tables).toContain("activity");
    expect(tables).toContain("sync_meta");
    expect(tables).toContain("schema_migrations");

    db.close();
  });

  it("creates expected indexes", () => {
    const db = createMemoryDatabase();
    const indexes = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(indexes).toContain("idx_notifications_repository");
    expect(indexes).toContain("idx_notifications_unread");
    expect(indexes).toContain("idx_notifications_updated");
    expect(indexes).toContain("idx_events_timestamp");
    expect(indexes).toContain("idx_pinned_group");
    expect(indexes).toContain("idx_activity_timestamp");
    expect(indexes).toContain("idx_activity_repository");

    db.close();
  });

  it("enforces foreign keys", () => {
    const db = createMemoryDatabase();

    expect(() => {
      db.run(
        `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
         VALUES ('nonexistent', 'e1', 'comment', 'user', datetime('now'))`,
      );
    }).toThrow();

    db.close();
  });

  it("enforces notification_events composite unique constraint", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Test issue', 'mention', datetime('now'))`,
    );

    db.run(
      `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
       VALUES ('t1', 'e1', 'comment', 'user', datetime('now'))`,
    );

    expect(() => {
      db.run(
        `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
         VALUES ('t1', 'e1', 'comment', 'user', datetime('now'))`,
      );
    }).toThrow();

    db.close();
  });

  it("cascades deletes from notifications to notification_events", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Test', 'mention', datetime('now'))`,
    );
    db.run(
      `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
       VALUES ('t1', 'e1', 'comment', 'user', datetime('now'))`,
    );

    db.run("DELETE FROM notifications WHERE thread_id = 't1'");

    const events = db
      .query<{ event_id: string }, []>(
        "SELECT event_id FROM notification_events WHERE notification_thread_id = 't1'",
      )
      .all();

    expect(events.length).toBe(0);

    db.close();
  });

  it("sets NULL on pinned when referenced notification is deleted", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Test', 'mention', datetime('now'))`,
    );
    db.run(
      `INSERT INTO pinned (notification_thread_id, subject_type, subject_title, subject_url, repository)
       VALUES ('t1', 'Issue', 'Test', 'https://github.com/test', 'owner/repo')`,
    );

    db.run("DELETE FROM notifications WHERE thread_id = 't1'");

    const pin = db
      .query<{ notification_thread_id: string | null }, []>(
        "SELECT notification_thread_id FROM pinned LIMIT 1",
      )
      .get();

    expect(pin?.notification_thread_id).toBeNull();

    db.close();
  });
});
