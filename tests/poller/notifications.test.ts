import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import { GHDDatabase } from "../../src/db/queries.js";
import { threadId } from "../../src/db/types.js";
import { NotificationPoller } from "../../src/poller/notifications.js";
import { FixtureGitHubClient } from "../helpers/github.js";

function setup() {
  const rawDb = createMemoryDatabase();
  const db = new GHDDatabase(rawDb);
  const github = new FixtureGitHubClient();
  const poller = new NotificationPoller(db, github);
  return { db, github, poller };
}

describe("NotificationPoller", () => {
  it("poll() inserts notifications from fixture data", async () => {
    const { db, poller } = setup();
    const result = await poller.poll();

    expect(result.processed).toBe(2);
    const notifications = db.getNotifications();
    expect(notifications.length).toBe(2);
    db.close();
  });

  it("poll() inserts timeline events for each notification", async () => {
    const { db, poller } = setup();
    await poller.poll();

    // Issue #42 has 2 mapped events (commented x2, labeled is mapped to "label")
    const issueEvents = db.getNotificationEvents(threadId("1234567890"));
    expect(issueEvents.length).toBeGreaterThan(0);

    // PR #99 has events (committed, reviewed, review_requested)
    const prEvents = db.getNotificationEvents(threadId("1234567891"));
    expect(prEvents.length).toBeGreaterThan(0);
    db.close();
  });

  it("poll() is idempotent — second call doesn't duplicate data", async () => {
    const { db, poller } = setup();
    await poller.poll();
    await poller.poll();

    const notifications = db.getNotifications();
    expect(notifications.length).toBe(2);
    db.close();
  });

  it("poll() updates sync_meta with last poll timestamp", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const lastPoll = db.getSyncMeta("notifications_last_poll");
    expect(lastPoll).not.toBeNull();
    db.close();
  });

  it("event types are correctly mapped from GitHub to our vocabulary", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const issueEvents = db.getNotificationEvents(threadId("1234567890"));
    const eventTypes = issueEvents.map((e) => e.event_type);
    expect(eventTypes).toContain("comment");
    expect(eventTypes).toContain("label");
    db.close();
  });
});
