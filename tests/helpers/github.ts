import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitHubClient } from "../../src/github/client.js";
import type {
  GitHubIssueDetails,
  GitHubNotificationThread,
  GitHubTimelineEvent,
  GitHubUserEvent,
  RateLimitInfo,
} from "../../src/github/types.js";

const FIXTURES_DIR = join(import.meta.dir, "../github/fixtures");

function loadFixture<T>(name: string): T {
  const content = readFileSync(join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(content) as T;
}

/**
 * A complete alternate implementation of GitHubClient that returns
 * recorded API responses from JSON fixture files.
 *
 * This is NOT a mock — it implements the full interface, and the
 * `satisfies` assertion at the bottom ensures compile-time conformance.
 */
export class FixtureGitHubClient implements GitHubClient {
  private notifications: GitHubNotificationThread[];
  private timelines: Map<string, GitHubTimelineEvent[]>;
  private issueDetails: Map<string, GitHubIssueDetails>;
  private userEvents: GitHubUserEvent[];
  private markedAsRead: Set<string> = new Set();

  constructor() {
    this.notifications = loadFixture<GitHubNotificationThread[]>("notifications.json");
    this.timelines = new Map([
      ["acme/project/42", loadFixture<GitHubTimelineEvent[]>("timeline-issue.json")],
      ["acme/project/99", loadFixture<GitHubTimelineEvent[]>("timeline-pr.json")],
    ]);
    this.issueDetails = new Map([
      ["acme/project/42", loadFixture<GitHubIssueDetails>("issue-details.json")],
      ["acme/project/99", loadFixture<GitHubIssueDetails>("pr-details.json")],
    ]);
    this.userEvents = loadFixture<GitHubUserEvent[]>("user-events.json");
  }

  async listNotifications(options?: {
    since?: string;
    all?: boolean;
  }): Promise<GitHubNotificationThread[]> {
    let result = this.notifications;
    if (options?.since) {
      const sinceDate = new Date(options.since);
      result = result.filter((n) => new Date(n.updated_at) > sinceDate);
    }
    return result;
  }

  async getTimelineEvents(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubTimelineEvent[]> {
    const key = `${owner}/${repo}/${String(issueNumber)}`;
    return this.timelines.get(key) ?? [];
  }

  async getIssueDetails(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssueDetails> {
    const key = `${owner}/${repo}/${String(issueNumber)}`;
    const details = this.issueDetails.get(key);
    if (!details) {
      throw new Error(`Fixture not found: ${key}`);
    }
    return details;
  }

  async listUserEvents(_username: string): Promise<GitHubUserEvent[]> {
    return this.userEvents;
  }

  async markThreadAsRead(threadId: string): Promise<void> {
    this.markedAsRead.add(threadId);
  }

  getRateLimit(): RateLimitInfo | null {
    return { remaining: 4999, limit: 5000, reset: Math.floor(Date.now() / 1000) + 3600 };
  }

  // Test helpers
  getMarkedAsRead(): Set<string> {
    return this.markedAsRead;
  }
}

// Compile-time conformance check
const _check: GitHubClient = new FixtureGitHubClient();
void _check;
