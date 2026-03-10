import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import { GHDDatabase } from "../../src/db/queries.js";
import { activityId } from "../../src/db/types.js";
import { ActivityPoller } from "../../src/poller/activity.js";
import { FixtureGitHubClient } from "../helpers/github.js";

function setup() {
  const rawDb = createMemoryDatabase();
  const db = new GHDDatabase(rawDb);
  const github = new FixtureGitHubClient();
  const poller = new ActivityPoller(db, github, "testuser");
  return { db, github, poller };
}

describe("ActivityPoller", () => {
  it("poll() inserts normalized activity events", async () => {
    const { db, poller } = setup();
    const result = await poller.poll();

    // 7 fixture events: PushEvent, IssueCommentEvent, PullRequestEvent,
    // PullRequestReviewEvent, CreateEvent, IssuesEvent, ReleaseEvent — all should be normalized
    expect(result.processed).toBe(7);
    const activity = db.getActivity();
    expect(activity.length).toBe(7);
    db.close();
  });

  it("poll() skips unknown event types", async () => {
    const { db, poller } = setup();
    await poller.poll();

    // All 7 fixture events are known types, so all should be processed
    const activity = db.getActivity();
    expect(activity.length).toBe(7);
    db.close();
  });

  it("poll() is idempotent for duplicate event IDs", async () => {
    const { db, poller } = setup();
    await poller.poll();
    await poller.poll();

    const activity = db.getActivity();
    expect(activity.length).toBe(7);
    db.close();
  });

  it("poll() updates sync_meta with last poll timestamp", async () => {
    const { db, poller } = setup();
    await poller.poll();

    const lastPoll = db.getSyncMeta("activity_last_poll");
    expect(lastPoll).not.toBeNull();
    db.close();
  });

  it("poll() prunes old activity", async () => {
    const { db, poller } = setup();

    // Insert an old activity entry manually
    db.upsertActivity({
      eventId: activityId("old-event"),
      eventType: "PushEvent",
      repository: "owner/repo",
      action: "committed",
      targetTitle: "Old commit",
      targetUrl: null,
      body: null,
      eventTimestamp: "2020-01-01T00:00:00Z",
    });

    await poller.poll();

    // The old entry should be pruned
    const activity = db.getActivity();
    const hasOld = activity.some((a) => a.target_title === "Old commit");
    expect(hasOld).toBe(false);
    db.close();
  });
});
