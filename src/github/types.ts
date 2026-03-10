// --- Notification Thread (GET /notifications) ---
export interface GitHubNotificationThread {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  last_read_at: string | null;
  subject: {
    title: string;
    url: string | null; // API URL, e.g. https://api.github.com/repos/.../issues/1
    type: string; // "Issue", "PullRequest", "Discussion", "Release", etc.
  };
  repository: {
    full_name: string; // "owner/repo"
    html_url: string;
  };
}

// --- Timeline Event (GET /repos/{owner}/{repo}/issues/{number}/timeline) ---
export interface GitHubTimelineEvent {
  id?: number;
  node_id?: string;
  event: string; // "commented", "reviewed", "merged", "closed", "renamed", etc.
  actor?: {
    login: string;
  } | null;
  user?: {
    login: string;
  } | null;
  body?: string | null;
  html_url?: string | null;
  created_at?: string;
  submitted_at?: string; // used by review events
  assignee?: { login: string } | null; // for assigned/unassigned events
  label?: { name: string } | null; // for labeled/unlabeled events
}

// --- User Event (GET /users/{username}/events) ---
export interface GitHubUserEvent {
  id: string;
  type: string; // "PushEvent", "IssueCommentEvent", "PullRequestEvent", etc.
  repo: {
    name: string; // "owner/repo"
  };
  payload: {
    action?: string; // "opened", "closed", "created", etc.
    pull_request?: { title: string; html_url: string; merged?: boolean; body?: string };
    issue?: { title: string; html_url: string; body?: string };
    comment?: { html_url: string; body?: string };
    commits?: Array<{ message: string }>;
    ref?: string;
    ref_type?: string;
    release?: { tag_name: string; html_url: string; body?: string };
    forkee?: { full_name: string; html_url: string };
  };
  created_at: string;
}

// --- Issue Details (GET /repos/{owner}/{repo}/issues/{number}) ---
export interface GitHubIssueDetails {
  number: number;
  title: string;
  body: string | null;
  user: {
    login: string;
  } | null;
  html_url: string;
}

// --- Discussion Details (GraphQL API) ---
export interface GitHubDiscussionDetails {
  number: number;
  title: string;
  body: string | null;
  url: string;
  author: {
    login: string;
  } | null;
}

// --- Rate Limit Info ---
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: number; // Unix timestamp
}
