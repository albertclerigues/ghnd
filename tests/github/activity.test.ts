import { describe, expect, it } from "bun:test";
import { normalizeUserEvent } from "../../src/github/activity.js";
import type { GitHubUserEvent } from "../../src/github/types.js";

function makeEvent(overrides: Partial<GitHubUserEvent> & { type: string }): GitHubUserEvent {
  return {
    id: "1",
    repo: { name: "owner/repo" },
    payload: {},
    created_at: "2026-03-10T00:00:00Z",
    ...overrides,
  };
}

describe("normalizeUserEvent", () => {
  it("handles PushEvent", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "PushEvent",
        payload: { commits: [{ message: "Fix bug" }] },
      }),
    );
    expect(result).toEqual({
      action: "committed",
      targetTitle: "Fix bug",
      targetUrl: null,
      body: null,
    });
  });

  it("handles IssueCommentEvent", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "IssueCommentEvent",
        payload: {
          action: "created",
          issue: { title: "Bug report", html_url: "https://github.com/owner/repo/issues/1" },
          comment: {
            html_url: "https://github.com/owner/repo/issues/1#issuecomment-1",
            body: "This is a comment body",
          },
        },
      }),
    );
    expect(result?.action).toBe("commented");
    expect(result?.targetTitle).toBe("Bug report");
    expect(result?.body).toBe("This is a comment body");
  });

  it("handles IssueCommentEvent without body", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "IssueCommentEvent",
        payload: {
          action: "created",
          issue: { title: "Bug report", html_url: "https://github.com/owner/repo/issues/1" },
          comment: { html_url: "https://github.com/owner/repo/issues/1#issuecomment-1" },
        },
      }),
    );
    expect(result?.body).toBeNull();
  });

  it("handles PullRequestEvent — opened", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "PullRequestEvent",
        payload: {
          action: "opened",
          pull_request: { title: "Add feature", html_url: "https://github.com/owner/repo/pull/1" },
        },
      }),
    );
    expect(result?.action).toBe("opened");
  });

  it("handles PullRequestEvent — closed (not merged)", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "PullRequestEvent",
        payload: {
          action: "closed",
          pull_request: {
            title: "PR",
            html_url: "https://github.com/owner/repo/pull/1",
            merged: false,
          },
        },
      }),
    );
    expect(result?.action).toBe("closed");
  });

  it("handles PullRequestEvent — closed (merged)", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "PullRequestEvent",
        payload: {
          action: "closed",
          pull_request: {
            title: "PR",
            html_url: "https://github.com/owner/repo/pull/1",
            merged: true,
          },
        },
      }),
    );
    expect(result?.action).toBe("merged");
  });

  it("handles PullRequestReviewEvent", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "PullRequestReviewEvent",
        payload: {
          action: "submitted",
          pull_request: { title: "PR", html_url: "https://github.com/owner/repo/pull/1" },
        },
      }),
    );
    expect(result?.action).toBe("reviewed");
  });

  it("handles IssuesEvent — opened", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "IssuesEvent",
        payload: {
          action: "opened",
          issue: { title: "New issue", html_url: "https://github.com/owner/repo/issues/1" },
        },
      }),
    );
    expect(result?.action).toBe("opened");
  });

  it("handles CreateEvent", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "CreateEvent",
        payload: { ref: "feature/new", ref_type: "branch" },
      }),
    );
    expect(result?.action).toBe("created");
    expect(result?.targetTitle).toBe("branch: feature/new");
  });

  it("handles DeleteEvent", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "DeleteEvent",
        payload: { ref: "feature/old", ref_type: "branch" },
      }),
    );
    expect(result?.action).toBe("deleted");
  });

  it("handles ForkEvent", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "ForkEvent",
        payload: { forkee: { full_name: "user/fork", html_url: "https://github.com/user/fork" } },
      }),
    );
    expect(result?.action).toBe("forked");
  });

  it("handles WatchEvent", () => {
    const result = normalizeUserEvent(makeEvent({ type: "WatchEvent" }));
    expect(result?.action).toBe("starred");
  });

  it("handles ReleaseEvent", () => {
    const result = normalizeUserEvent(
      makeEvent({
        type: "ReleaseEvent",
        payload: {
          release: { tag_name: "v1.0", html_url: "https://github.com/owner/repo/releases/v1.0" },
        },
      }),
    );
    expect(result?.action).toBe("released");
  });

  it("returns null for unknown event types", () => {
    expect(normalizeUserEvent(makeEvent({ type: "GollumEvent" }))).toBeNull();
    expect(normalizeUserEvent(makeEvent({ type: "MemberEvent" }))).toBeNull();
  });
});
