import type { ActivityAction } from "../db/types.js";
import type { GitHubUserEvent } from "./types.js";

interface NormalizedActivity {
  action: ActivityAction;
  targetTitle: string;
  targetUrl: string | null;
  body: string | null;
}

type EventHandler = (event: GitHubUserEvent) => NormalizedActivity | null;

function handlePushEvent(event: GitHubUserEvent): NormalizedActivity {
  const firstCommit = event.payload.commits?.[0];
  return {
    action: "committed",
    targetTitle: firstCommit?.message ?? "Push",
    targetUrl: null,
    body: null,
  };
}

function handleIssueCommentEvent(event: GitHubUserEvent): NormalizedActivity {
  return {
    action: "commented",
    targetTitle: event.payload.issue?.title ?? "Comment",
    targetUrl: event.payload.comment?.html_url ?? null,
    body: event.payload.comment?.body ?? null,
  };
}

function handlePullRequestEvent(event: GitHubUserEvent): NormalizedActivity | null {
  const pr = event.payload.pull_request;
  const action = mapPullRequestAction(event.payload.action, pr?.merged);
  if (!action) return null;
  return {
    action,
    targetTitle: pr?.title ?? "Pull Request",
    targetUrl: pr?.html_url ?? null,
    body: null,
  };
}

function handlePullRequestReviewEvent(event: GitHubUserEvent): NormalizedActivity {
  return {
    action: "reviewed",
    targetTitle: event.payload.pull_request?.title ?? "Review",
    targetUrl: event.payload.pull_request?.html_url ?? null,
    body: null,
  };
}

function handleIssuesEvent(event: GitHubUserEvent): NormalizedActivity | null {
  const action = mapIssueAction(event.payload.action);
  if (!action) return null;
  return {
    action,
    targetTitle: event.payload.issue?.title ?? "Issue",
    targetUrl: event.payload.issue?.html_url ?? null,
    body: null,
  };
}

function handleCreateEvent(event: GitHubUserEvent): NormalizedActivity {
  return {
    action: "created",
    targetTitle: event.payload.ref
      ? `${event.payload.ref_type ?? "ref"}: ${event.payload.ref}`
      : (event.payload.ref_type ?? "repository"),
    targetUrl: null,
    body: null,
  };
}

function handleDeleteEvent(event: GitHubUserEvent): NormalizedActivity {
  return {
    action: "deleted",
    targetTitle: event.payload.ref
      ? `${event.payload.ref_type ?? "ref"}: ${event.payload.ref}`
      : (event.payload.ref_type ?? "ref"),
    targetUrl: null,
    body: null,
  };
}

function handleForkEvent(event: GitHubUserEvent): NormalizedActivity {
  return {
    action: "forked",
    targetTitle: event.payload.forkee?.full_name ?? "Fork",
    targetUrl: event.payload.forkee?.html_url ?? null,
    body: null,
  };
}

function handleWatchEvent(event: GitHubUserEvent): NormalizedActivity {
  return {
    action: "starred",
    targetTitle: event.repo.name,
    targetUrl: null,
    body: null,
  };
}

function handleReleaseEvent(event: GitHubUserEvent): NormalizedActivity {
  return {
    action: "released",
    targetTitle: event.payload.release?.tag_name ?? "Release",
    targetUrl: event.payload.release?.html_url ?? null,
    body: null,
  };
}

const EVENT_HANDLERS: Record<string, EventHandler> = {
  PushEvent: handlePushEvent,
  IssueCommentEvent: handleIssueCommentEvent,
  PullRequestEvent: handlePullRequestEvent,
  PullRequestReviewEvent: handlePullRequestReviewEvent,
  IssuesEvent: handleIssuesEvent,
  CreateEvent: handleCreateEvent,
  DeleteEvent: handleDeleteEvent,
  ForkEvent: handleForkEvent,
  WatchEvent: handleWatchEvent,
  ReleaseEvent: handleReleaseEvent,
};

export function normalizeUserEvent(event: GitHubUserEvent): NormalizedActivity | null {
  const handler = EVENT_HANDLERS[event.type];
  if (!handler) return null;
  return handler(event);
}

function mapPullRequestAction(
  action: string | undefined,
  merged: boolean | undefined,
): ActivityAction | null {
  if (action === "closed" && merged) return "merged";
  if (action === "closed") return "closed";
  if (action === "opened" || action === "reopened") return "opened";
  return null;
}

function mapIssueAction(action: string | undefined): ActivityAction | null {
  if (action === "opened" || action === "reopened") return "opened";
  if (action === "closed") return "closed";
  return null;
}
