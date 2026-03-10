import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import { GHDDatabase } from "../../src/db/queries.js";
import { activityId, eventId, pinId, threadId } from "../../src/db/types.js";

function createTestDb(): GHDDatabase {
  return new GHDDatabase(createMemoryDatabase());
}

describe("GHDDatabase — Notifications", () => {
  it("upsertNotification inserts a new notification", () => {
    const db = createTestDb();
    db.upsertNotification({
      threadId: threadId("t1"),
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Bug report",
      subjectUrl: "https://github.com/owner/repo/issues/1",
      reason: "mention",
      unread: true,
      githubUpdatedAt: "2026-03-10T00:00:00Z",
      githubLastReadAt: null,
    });

    const rows = db.getNotifications();
    expect(rows.length).toBe(1);
    expect(rows[0]?.subject_title).toBe("Bug report");
    expect(rows[0]?.unread).toBe(1);
    db.close();
  });

  it("upsertNotification updates existing notification", () => {
    const db = createTestDb();
    const tid = threadId("t1");

    db.upsertNotification({
      threadId: tid,
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Old title",
      subjectUrl: null,
      reason: "mention",
      unread: true,
      githubUpdatedAt: "2026-03-10T00:00:00Z",
      githubLastReadAt: null,
    });

    db.upsertNotification({
      threadId: tid,
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "New title",
      subjectUrl: null,
      reason: "mention",
      unread: false,
      githubUpdatedAt: "2026-03-10T01:00:00Z",
      githubLastReadAt: "2026-03-10T00:30:00Z",
    });

    const rows = db.getNotifications();
    expect(rows.length).toBe(1);
    expect(rows[0]?.subject_title).toBe("New title");
    expect(rows[0]?.unread).toBe(0);
    db.close();
  });

  it("getNotifications excludes dismissed by default", () => {
    const db = createTestDb();
    const tid = threadId("t1");

    db.upsertNotification({
      threadId: tid,
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Bug",
      subjectUrl: null,
      reason: "mention",
      unread: true,
      githubUpdatedAt: "2026-03-10T00:00:00Z",
      githubLastReadAt: null,
    });
    db.dismissNotification(tid);

    expect(db.getNotifications().length).toBe(0);
    expect(db.getNotifications({ includeDismissed: true }).length).toBe(1);
    db.close();
  });

  it("getNotifications with unreadOnly", () => {
    const db = createTestDb();

    db.upsertNotification({
      threadId: threadId("t1"),
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Unread",
      subjectUrl: null,
      reason: "mention",
      unread: true,
      githubUpdatedAt: "2026-03-10T01:00:00Z",
      githubLastReadAt: null,
    });

    db.upsertNotification({
      threadId: threadId("t2"),
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Read",
      subjectUrl: null,
      reason: "mention",
      unread: false,
      githubUpdatedAt: "2026-03-10T00:00:00Z",
      githubLastReadAt: "2026-03-10T00:00:00Z",
    });

    expect(db.getNotifications({ unreadOnly: true }).length).toBe(1);
    expect(db.getNotifications().length).toBe(2);
    db.close();
  });

  it("getNotificationByThreadId returns null for nonexistent", () => {
    const db = createTestDb();
    expect(db.getNotificationByThreadId(threadId("nonexistent"))).toBeNull();
    db.close();
  });
});

describe("GHDDatabase — Notification Events", () => {
  it("upsertNotificationEvent inserts and retrieves events", () => {
    const db = createTestDb();
    const tid = threadId("t1");

    db.upsertNotification({
      threadId: tid,
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Bug",
      subjectUrl: null,
      reason: "mention",
      unread: true,
      githubUpdatedAt: "2026-03-10T00:00:00Z",
      githubLastReadAt: null,
    });

    db.upsertNotificationEvent({
      notificationThreadId: tid,
      eventId: eventId("e1"),
      eventType: "comment",
      actor: "alice",
      body: "This is a comment",
      summary: null,
      url: "https://github.com/owner/repo/issues/1#issuecomment-1",
      eventTimestamp: "2026-03-10T01:00:00Z",
    });

    const events = db.getNotificationEvents(tid);
    expect(events.length).toBe(1);
    expect(events[0]?.actor).toBe("alice");
    expect(events[0]?.event_type).toBe("comment");
    db.close();
  });

  it("upsertNotificationEvent updates on conflict", () => {
    const db = createTestDb();
    const tid = threadId("t1");

    db.upsertNotification({
      threadId: tid,
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Bug",
      subjectUrl: null,
      reason: "mention",
      unread: true,
      githubUpdatedAt: "2026-03-10T00:00:00Z",
      githubLastReadAt: null,
    });

    db.upsertNotificationEvent({
      notificationThreadId: tid,
      eventId: eventId("e1"),
      eventType: "comment",
      actor: "alice",
      body: "Original body",
      summary: null,
      url: null,
      eventTimestamp: "2026-03-10T01:00:00Z",
    });

    db.upsertNotificationEvent({
      notificationThreadId: tid,
      eventId: eventId("e1"),
      eventType: "comment",
      actor: "alice",
      body: "Updated body",
      summary: "Alice updated the comment",
      url: null,
      eventTimestamp: "2026-03-10T01:00:00Z",
    });

    const events = db.getNotificationEvents(tid);
    expect(events.length).toBe(1);
    expect(events[0]?.body).toBe("Updated body");
    expect(events[0]?.summary).toBe("Alice updated the comment");
    db.close();
  });

  it("getNotificationEvents ordered by timestamp", () => {
    const db = createTestDb();
    const tid = threadId("t1");

    db.upsertNotification({
      threadId: tid,
      repository: "owner/repo",
      subjectType: "Issue",
      subjectTitle: "Bug",
      subjectUrl: null,
      reason: "mention",
      unread: true,
      githubUpdatedAt: "2026-03-10T00:00:00Z",
      githubLastReadAt: null,
    });

    db.upsertNotificationEvent({
      notificationThreadId: tid,
      eventId: eventId("e2"),
      eventType: "comment",
      actor: "bob",
      body: null,
      summary: null,
      url: null,
      eventTimestamp: "2026-03-10T02:00:00Z",
    });

    db.upsertNotificationEvent({
      notificationThreadId: tid,
      eventId: eventId("e1"),
      eventType: "comment",
      actor: "alice",
      body: null,
      summary: null,
      url: null,
      eventTimestamp: "2026-03-10T01:00:00Z",
    });

    const events = db.getNotificationEvents(tid);
    expect(events[0]?.actor).toBe("alice");
    expect(events[1]?.actor).toBe("bob");
    db.close();
  });
});

describe("GHDDatabase — Activity", () => {
  it("upsertActivity inserts activity", () => {
    const db = createTestDb();
    db.upsertActivity({
      eventId: activityId("a1"),
      eventType: "PushEvent",
      repository: "owner/repo",
      action: "committed",
      targetTitle: "Fix typo",
      targetUrl: null,
      eventTimestamp: "2026-03-10T00:00:00Z",
    });

    const rows = db.getActivity();
    expect(rows.length).toBe(1);
    expect(rows[0]?.action).toBe("committed");
    db.close();
  });

  it("upsertActivity does nothing on duplicate eventId", () => {
    const db = createTestDb();
    const eid = activityId("a1");

    db.upsertActivity({
      eventId: eid,
      eventType: "PushEvent",
      repository: "owner/repo",
      action: "committed",
      targetTitle: "First",
      targetUrl: null,
      eventTimestamp: "2026-03-10T00:00:00Z",
    });

    db.upsertActivity({
      eventId: eid,
      eventType: "PushEvent",
      repository: "owner/repo",
      action: "committed",
      targetTitle: "Second",
      targetUrl: null,
      eventTimestamp: "2026-03-10T00:00:00Z",
    });

    const rows = db.getActivity();
    expect(rows.length).toBe(1);
    expect(rows[0]?.target_title).toBe("First");
    db.close();
  });

  it("getActivity respects limit", () => {
    const db = createTestDb();
    for (let i = 0; i < 5; i++) {
      db.upsertActivity({
        eventId: activityId(`a${String(i)}`),
        eventType: "PushEvent",
        repository: "owner/repo",
        action: "committed",
        targetTitle: `Commit ${String(i)}`,
        targetUrl: null,
        eventTimestamp: `2026-03-10T0${String(i)}:00:00Z`,
      });
    }

    expect(db.getActivity({ limit: 3 }).length).toBe(3);
    expect(db.getActivity().length).toBe(5);
    db.close();
  });

  it("pruneActivity removes old entries", () => {
    const db = createTestDb();
    db.upsertActivity({
      eventId: activityId("old"),
      eventType: "PushEvent",
      repository: "owner/repo",
      action: "committed",
      targetTitle: "Old commit",
      targetUrl: null,
      eventTimestamp: "2020-01-01T00:00:00Z",
    });

    db.upsertActivity({
      eventId: activityId("new"),
      eventType: "PushEvent",
      repository: "owner/repo",
      action: "committed",
      targetTitle: "New commit",
      targetUrl: null,
      eventTimestamp: "2026-03-10T00:00:00Z",
    });

    const removed = db.pruneActivity(30);
    expect(removed).toBe(1);
    expect(db.getActivity().length).toBe(1);
    expect(db.getActivity()[0]?.target_title).toBe("New commit");
    db.close();
  });
});

describe("GHDDatabase — Pinned", () => {
  it("pinItem inserts a pin with default group", () => {
    const db = createTestDb();
    const id = db.pinItem({
      subjectType: "Issue",
      subjectTitle: "Bug report",
      subjectUrl: "https://github.com/owner/repo/issues/1",
      repository: "owner/repo",
    });

    const groups = db.getPinnedGrouped();
    expect(groups.size).toBe(1);
    expect(groups.has("Default")).toBe(true);
    const items = groups.get("Default");
    expect(items).toBeDefined();
    expect(items?.length).toBe(1);
    expect(items?.[0]?.subject_title).toBe("Bug report");
    expect(items?.[0]?.id).toBe(id as number);
    db.close();
  });

  it("pinItem with explicit group name", () => {
    const db = createTestDb();
    db.pinItem({
      subjectType: "PullRequest",
      subjectTitle: "Feature PR",
      subjectUrl: "https://github.com/owner/repo/pull/2",
      repository: "owner/repo",
      groupName: "Watching",
    });

    const groups = db.getPinnedGrouped();
    expect(groups.has("Watching")).toBe(true);
    expect(groups.get("Watching")?.[0]?.subject_title).toBe("Feature PR");
    db.close();
  });

  it("pinItem auto-increments sort order within a group", () => {
    const db = createTestDb();
    db.pinItem({
      subjectType: "Issue",
      subjectTitle: "First",
      subjectUrl: "https://github.com/owner/repo/issues/1",
      repository: "owner/repo",
      groupName: "MyGroup",
    });
    db.pinItem({
      subjectType: "Issue",
      subjectTitle: "Second",
      subjectUrl: "https://github.com/owner/repo/issues/2",
      repository: "owner/repo",
      groupName: "MyGroup",
    });

    const groups = db.getPinnedGrouped();
    const items = groups.get("MyGroup");
    expect(items).toBeDefined();
    expect(items?.length).toBe(2);
    expect(items?.[0]?.sort_order).toBe(0);
    expect(items?.[1]?.sort_order).toBe(1);
    db.close();
  });

  it("unpinItem removes the pin", () => {
    const db = createTestDb();
    const id = db.pinItem({
      subjectType: "Issue",
      subjectTitle: "To remove",
      subjectUrl: "https://github.com/owner/repo/issues/1",
      repository: "owner/repo",
    });

    db.unpinItem(id);
    const groups = db.getPinnedGrouped();
    expect(groups.size).toBe(0);
    db.close();
  });

  it("unpinItem is idempotent for nonexistent id", () => {
    const db = createTestDb();
    // Should not throw
    db.unpinItem(pinId(999));
    db.close();
  });
});

describe("GHDDatabase — Sync Meta", () => {
  it("getSyncMeta returns null for nonexistent key", () => {
    const db = createTestDb();
    expect(db.getSyncMeta("nonexistent")).toBeNull();
    db.close();
  });

  it("setSyncMeta inserts and retrieves", () => {
    const db = createTestDb();
    db.setSyncMeta("last_poll", "2026-03-10T00:00:00Z");
    expect(db.getSyncMeta("last_poll")).toBe("2026-03-10T00:00:00Z");
    db.close();
  });

  it("setSyncMeta upserts existing key", () => {
    const db = createTestDb();
    db.setSyncMeta("last_poll", "2026-03-09T00:00:00Z");
    db.setSyncMeta("last_poll", "2026-03-10T00:00:00Z");
    expect(db.getSyncMeta("last_poll")).toBe("2026-03-10T00:00:00Z");
    db.close();
  });

  it("rawQuery returns results", () => {
    const db = createTestDb();
    db.setSyncMeta("key1", "value1");
    const results = db.rawQuery("SELECT * FROM sync_meta");
    expect(results.length).toBe(1);
    db.close();
  });
});
