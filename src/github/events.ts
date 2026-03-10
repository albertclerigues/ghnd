import type { NotificationEventType } from "../db/types.js";
import type { GitHubTimelineEvent } from "./types.js";

const EVENT_TYPE_MAP: Record<string, NotificationEventType> = {
  commented: "comment",
  reviewed: "review",
  review_requested: "review_request",
  merged: "merge",
  closed: "close",
  reopened: "reopen",
  labeled: "label",
  unlabeled: "label",
  assigned: "assignment",
  unassigned: "assignment",
  renamed: "rename",
  referenced: "reference",
  committed: "commit",
};

export function mapEventType(githubEvent: string): NotificationEventType | null {
  return EVENT_TYPE_MAP[githubEvent] ?? null;
}

export function extractActor(event: GitHubTimelineEvent): string {
  return event.actor?.login ?? event.user?.login ?? "unknown";
}

export function extractTimestamp(event: GitHubTimelineEvent): string {
  // Review events use submitted_at, everything else uses created_at
  return event.submitted_at ?? event.created_at ?? new Date().toISOString();
}

export function extractBody(event: GitHubTimelineEvent): string | null {
  if (event.body) return event.body;
  // Construct a descriptive body for metadata events
  if (event.event === "assigned" && event.assignee) {
    return `assigned @${event.assignee.login}`;
  }
  if (event.event === "unassigned" && event.assignee) {
    return `unassigned @${event.assignee.login}`;
  }
  if (event.event === "labeled" && event.label) {
    return `added ${event.label.name}`;
  }
  if (event.event === "unlabeled" && event.label) {
    return `removed ${event.label.name}`;
  }
  return null;
}

export function extractEventId(event: GitHubTimelineEvent): string {
  // Use node_id first (guaranteed unique), fall back to numeric id
  if (event.node_id) return event.node_id;
  if (event.id !== undefined) return String(event.id);
  // Last resort: hash from event type + timestamp
  return `${event.event}-${extractTimestamp(event)}`;
}
