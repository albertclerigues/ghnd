import { describe, expect, it } from "bun:test";
import {
  extractActor,
  extractBody,
  extractEventId,
  extractTimestamp,
  mapEventType,
} from "../../src/github/events.js";
import type { GitHubTimelineEvent } from "../../src/github/types.js";

describe("mapEventType", () => {
  it("maps known GitHub event strings", () => {
    expect(mapEventType("commented")).toBe("comment");
    expect(mapEventType("reviewed")).toBe("review");
    expect(mapEventType("review_requested")).toBe("review_request");
    expect(mapEventType("merged")).toBe("merge");
    expect(mapEventType("closed")).toBe("close");
    expect(mapEventType("reopened")).toBe("reopen");
    expect(mapEventType("labeled")).toBe("label");
    expect(mapEventType("unlabeled")).toBe("label");
    expect(mapEventType("assigned")).toBe("assignment");
    expect(mapEventType("unassigned")).toBe("assignment");
    expect(mapEventType("renamed")).toBe("rename");
    expect(mapEventType("referenced")).toBe("reference");
    expect(mapEventType("committed")).toBe("commit");
  });

  it("returns null for unknown events", () => {
    expect(mapEventType("unknown_event")).toBeNull();
    expect(mapEventType("subscribed")).toBeNull();
  });
});

describe("extractActor", () => {
  it("prefers actor.login over user.login", () => {
    const event: GitHubTimelineEvent = {
      event: "commented",
      actor: { login: "alice" },
      user: { login: "bob" },
    };
    expect(extractActor(event)).toBe("alice");
  });

  it("falls back to user.login", () => {
    const event: GitHubTimelineEvent = {
      event: "reviewed",
      actor: null,
      user: { login: "carol" },
    };
    expect(extractActor(event)).toBe("carol");
  });

  it("returns 'unknown' when neither exists", () => {
    const event: GitHubTimelineEvent = {
      event: "committed",
      actor: null,
    };
    expect(extractActor(event)).toBe("unknown");
  });
});

describe("extractTimestamp", () => {
  it("prefers submitted_at for reviews", () => {
    const event: GitHubTimelineEvent = {
      event: "reviewed",
      created_at: "2026-03-10T07:00:00Z",
      submitted_at: "2026-03-10T08:00:00Z",
    };
    expect(extractTimestamp(event)).toBe("2026-03-10T08:00:00Z");
  });

  it("uses created_at when submitted_at is absent", () => {
    const event: GitHubTimelineEvent = {
      event: "commented",
      created_at: "2026-03-10T07:00:00Z",
    };
    expect(extractTimestamp(event)).toBe("2026-03-10T07:00:00Z");
  });
});

describe("extractEventId", () => {
  it("prefers node_id over numeric id", () => {
    const event: GitHubTimelineEvent = {
      event: "commented",
      id: 12345,
      node_id: "MDEyOklzc3VlQ29tbWVudDEyMzQ1",
    };
    expect(extractEventId(event)).toBe("MDEyOklzc3VlQ29tbWVudDEyMzQ1");
  });

  it("falls back to numeric id", () => {
    const event: GitHubTimelineEvent = {
      event: "commented",
      id: 12345,
    };
    expect(extractEventId(event)).toBe("12345");
  });

  it("generates fallback id from event type + timestamp", () => {
    const event: GitHubTimelineEvent = {
      event: "committed",
      created_at: "2026-03-10T07:00:00Z",
    };
    expect(extractEventId(event)).toBe("committed-2026-03-10T07:00:00Z");
  });
});

describe("extractBody", () => {
  it("returns body when present", () => {
    const event: GitHubTimelineEvent = {
      event: "commented",
      body: "This is a comment.",
    };
    expect(extractBody(event)).toBe("This is a comment.");
  });

  it("constructs body for assigned events", () => {
    const event: GitHubTimelineEvent = {
      event: "assigned",
      assignee: { login: "alice" },
    };
    expect(extractBody(event)).toBe("assigned @alice");
  });

  it("constructs body for unassigned events", () => {
    const event: GitHubTimelineEvent = {
      event: "unassigned",
      assignee: { login: "bob" },
    };
    expect(extractBody(event)).toBe("unassigned @bob");
  });

  it("constructs body for labeled events", () => {
    const event: GitHubTimelineEvent = {
      event: "labeled",
      label: { name: "bug" },
    };
    expect(extractBody(event)).toBe("added bug");
  });

  it("constructs body for unlabeled events", () => {
    const event: GitHubTimelineEvent = {
      event: "unlabeled",
      label: { name: "wontfix" },
    };
    expect(extractBody(event)).toBe("removed wontfix");
  });

  it("returns null when no body or metadata", () => {
    const event: GitHubTimelineEvent = {
      event: "closed",
    };
    expect(extractBody(event)).toBeNull();
  });
});
