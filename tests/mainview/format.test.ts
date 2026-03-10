import { describe, expect, it } from "bun:test";
import {
  actionColor,
  eventTypeLabel,
  relativeTime,
  subjectTypeIcon,
} from "../../src/mainview/format.js";

describe("relativeTime", () => {
  it("returns 'just now' for timestamps less than 60 seconds ago", () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for timestamps less than 60 minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago for timestamps less than 24 hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days ago for timestamps less than 30 days ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("returns date string for timestamps older than 30 days", () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const result = relativeTime(oldDate);
    // Should be a locale date string, not "Xd ago"
    expect(result).not.toContain("d ago");
    expect(result).not.toBe("just now");
  });
});

describe("subjectTypeIcon", () => {
  it("returns correct icon for Issue", () => {
    expect(subjectTypeIcon("Issue")).toBe("\u25CB");
  });

  it("returns correct icon for PullRequest", () => {
    expect(subjectTypeIcon("PullRequest")).toBe("\u21C4");
  });

  it("returns correct icon for Discussion", () => {
    expect(subjectTypeIcon("Discussion")).toBe("\u2637");
  });

  it("returns correct icon for Release", () => {
    expect(subjectTypeIcon("Release")).toBe("\u25C6");
  });

  it("returns correct icon for Commit", () => {
    expect(subjectTypeIcon("Commit")).toBe("\u2022");
  });

  it("returns default icon for unknown types", () => {
    expect(subjectTypeIcon("UnknownType")).toBe("\u25CB");
  });
});

describe("eventTypeLabel", () => {
  it("returns 'commented' for comment", () => {
    expect(eventTypeLabel("comment")).toBe("commented");
  });

  it("returns 'reviewed' for review", () => {
    expect(eventTypeLabel("review")).toBe("reviewed");
  });

  it("returns 'merged' for merge", () => {
    expect(eventTypeLabel("merge")).toBe("merged");
  });

  it("returns the raw type for unknown event types", () => {
    expect(eventTypeLabel("custom_event")).toBe("custom_event");
  });
});

describe("actionColor", () => {
  it("returns green for committed", () => {
    expect(actionColor("committed")).toBe("#a6e3a1");
  });

  it("returns blue for commented", () => {
    expect(actionColor("commented")).toBe("#89b4fa");
  });

  it("returns red for closed", () => {
    expect(actionColor("closed")).toBe("#f38ba8");
  });

  it("returns purple for merged", () => {
    expect(actionColor("merged")).toBe("#cba6f7");
  });

  it("returns fallback for unknown actions", () => {
    expect(actionColor("unknown_action")).toBe("var(--text-muted)");
  });
});
