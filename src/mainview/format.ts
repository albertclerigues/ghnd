export function relativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  if (diffHour < 24) return `${String(diffHour)}h ago`;
  if (diffDay < 30) return `${String(diffDay)}d ago`;
  return new Date(isoTimestamp).toLocaleDateString();
}

const SUBJECT_TYPE_ICONS: Record<string, string> = {
  Issue: "\u25CB", // ○
  PullRequest: "\u21C4", // ⇄
  Discussion: "\u2637", // ☷
  Release: "\u25C6", // ◆
  Commit: "\u2022", // •
};

export function subjectTypeIcon(subjectType: string): string {
  return SUBJECT_TYPE_ICONS[subjectType] ?? "\u25CB";
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  comment: "commented",
  review: "reviewed",
  review_request: "review requested",
  merge: "merged",
  close: "closed",
  reopen: "reopened",
  label: "labeled",
  assignment: "assigned",
  rename: "renamed",
  reference: "referenced",
  commit: "committed",
};

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

const ACTION_COLORS: Record<string, string> = {
  committed: "#a6e3a1", // green
  commented: "#89b4fa", // blue
  opened: "#a6e3a1", // green
  closed: "#f38ba8", // red
  merged: "#cba6f7", // purple
  reviewed: "#f9e2af", // yellow
  created: "#a6e3a1", // green
  deleted: "#f38ba8", // red
  forked: "#89b4fa", // blue
  starred: "#f9e2af", // yellow
  released: "#94e2d5", // teal
};

export function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? "var(--text-muted)";
}
