import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import { GHDDatabase } from "../../src/db/queries.js";
import { threadId } from "../../src/db/types.js";
import { NotificationPoller } from "../../src/poller/notifications.js";
import { StubSummarizer } from "../../src/summarizer/stub.js";
import type { Summarizer } from "../../src/summarizer/types.js";
import { FixtureGitHubClient } from "../helpers/github.js";

function setup(options?: { summarizer?: Summarizer }) {
  const rawDb = createMemoryDatabase();
  const db = new GHDDatabase(rawDb);
  const github = new FixtureGitHubClient();
  const poller = new NotificationPoller(db, github, {
    summarizer: options?.summarizer,
  });
  return { db, github, poller };
}

describe("NotificationPoller", () => {
  it("poll() inserts notifications from fixture data", async () => {
    const { db, poller } = setup();
    const result = await poller.poll();

    expect(result.processed).toBe(3);
    const notifications = db.getNotifications();
    expect(notifications.length).toBe(3);
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
    expect(notifications.length).toBe(3);
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

  it("poll() with summarizer populates description_summary", async () => {
    const stub = new StubSummarizer();
    const { db, poller } = setup({ summarizer: stub });
    await poller.poll();

    // Wait for async summarization to complete
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    const notifications = db.getNotifications();
    const withSummary = notifications.filter((n) => n.description_summary !== null);
    expect(withSummary.length).toBeGreaterThan(0);
    expect(stub.calls.length).toBeGreaterThan(0);
    db.close();
  });

  it("poll() with summarizer populates event summaries on comment events", async () => {
    const stub = new StubSummarizer();
    const { db, poller } = setup({ summarizer: stub });
    await poller.poll();

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    const events = db.getNotificationEvents(threadId("1234567890"));
    const commentEvents = events.filter((e) => e.event_type === "comment");
    const withSummary = commentEvents.filter((e) => e.summary !== null);
    expect(withSummary.length).toBeGreaterThan(0);
    db.close();
  });

  it("poll() without summarizer leaves summaries as null", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const notifications = db.getNotifications();
    for (const n of notifications) {
      expect(n.description_summary).toBeNull();
    }
    db.close();
  });

  it("poll() stores description body from issue details", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const notifications = db.getNotifications();
    const issue = notifications.find((n) => n.thread_id === "1234567890");
    expect(issue?.description_body).toContain("dark mode");

    const pr = notifications.find((n) => n.thread_id === "1234567891");
    expect(pr?.description_body).toContain("LRU cache");
    db.close();
  });

  it("poll() stores assignee info in event body", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const events = db.getNotificationEvents(threadId("1234567890"));
    const assignmentEvents = events.filter((e) => e.event_type === "assignment");
    expect(assignmentEvents.length).toBe(2);
    expect(assignmentEvents[0]?.body).toBe("assigned @alice");
    expect(assignmentEvents[1]?.body).toBe("assigned @carol");
    db.close();
  });

  it("poll() stores label info in event body", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const events = db.getNotificationEvents(threadId("1234567890"));
    const labelEvents = events.filter((e) => e.event_type === "label");
    expect(labelEvents.length).toBe(1);
    expect(labelEvents[0]?.body).toBe("added bug");
    db.close();
  });

  it("poll() backfills missing descriptions for existing notifications", async () => {
    const { db, poller } = setup();

    // Manually insert a notification without a description (simulating pre-feature data)
    db.upsertNotification({
      threadId: threadId("9999999999"),
      repository: "acme/project",
      subjectType: "Issue",
      subjectTitle: "Fix memory leak in notification poller",
      subjectUrl: "https://github.com/acme/project/issues/42",
      reason: "subscribed",
      unread: true,
      githubUpdatedAt: "2026-01-01T00:00:00Z",
      githubLastReadAt: null,
    });

    // Verify no description yet
    const before = db.getNotificationByThreadId(threadId("9999999999"));
    expect(before?.description_body).toBeNull();

    // Poll — the `since` filter won't re-process this notification,
    // but the backfill step should pick it up
    await poller.poll();

    const after = db.getNotificationByThreadId(threadId("9999999999"));
    expect(after?.description_body).toContain("dark mode");
  });

  it("poll() with failing summarizer still stores notifications and events", async () => {
    const failingSummarizer: Summarizer = {
      async summarize() {
        throw new Error("API unavailable");
      },
    };
    const { db, poller } = setup({ summarizer: failingSummarizer });
    await poller.poll();

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    const notifications = db.getNotifications();
    expect(notifications.length).toBe(3);
    db.close();
  });

  it("poll() stores discussion description via GraphQL", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const discussion = db.getNotificationByThreadId(threadId("1234567892"));
    expect(discussion?.description_body).toContain("plugin architecture");
    db.close();
  });

  it("poll() backfills missing discussion descriptions", async () => {
    const { db, poller } = setup();

    // Manually insert a discussion notification without a description
    db.upsertNotification({
      threadId: threadId("8888888888"),
      repository: "acme/project",
      subjectType: "Discussion",
      subjectTitle: "RFC: New plugin architecture",
      subjectUrl: "https://github.com/acme/project/discussions/55",
      reason: "subscribed",
      unread: true,
      githubUpdatedAt: "2026-01-01T00:00:00Z",
      githubLastReadAt: null,
    });

    const before = db.getNotificationByThreadId(threadId("8888888888"));
    expect(before?.description_body).toBeNull();

    await poller.poll();

    const after = db.getNotificationByThreadId(threadId("8888888888"));
    expect(after?.description_body).toContain("plugin architecture");
    db.close();
  });
});
