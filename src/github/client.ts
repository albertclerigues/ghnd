import type {
  GitHubIssueDetails,
  GitHubNotificationThread,
  GitHubTimelineEvent,
  GitHubUserEvent,
  RateLimitInfo,
} from "./types.js";

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const LOW_RATE_LIMIT_THRESHOLD = 100;

// --- Interface (for fixture-based testing) ---

export interface GitHubClient {
  listNotifications(options?: {
    since?: string;
    all?: boolean;
  }): Promise<GitHubNotificationThread[]>;

  getTimelineEvents(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubTimelineEvent[]>;

  listUserEvents(username: string): Promise<GitHubUserEvent[]>;

  getIssueDetails(owner: string, repo: string, issueNumber: number): Promise<GitHubIssueDetails>;

  markThreadAsRead(threadId: string): Promise<void>;

  getRateLimit(): RateLimitInfo | null;
}

// --- Fetch-based implementation ---

export class FetchGitHubClient implements GitHubClient {
  private lastRateLimit: RateLimitInfo | null = null;

  constructor(private readonly token: string) {}

  async listNotifications(options?: {
    since?: string;
    all?: boolean;
  }): Promise<GitHubNotificationThread[]> {
    const params = new URLSearchParams();
    if (options?.since) {
      params.set("since", options.since);
    }
    if (options?.all) {
      params.set("all", "true");
    }
    params.set("per_page", "50");

    return this.paginatedGet<GitHubNotificationThread>(`/notifications?${params.toString()}`);
  }

  async getTimelineEvents(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubTimelineEvent[]> {
    return this.paginatedGet<GitHubTimelineEvent>(
      `/repos/${owner}/${repo}/issues/${String(issueNumber)}/timeline`,
    );
  }

  async getIssueDetails(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssueDetails> {
    return this.get<GitHubIssueDetails>(`/repos/${owner}/${repo}/issues/${String(issueNumber)}`);
  }

  async listUserEvents(username: string): Promise<GitHubUserEvent[]> {
    // Events API doesn't support pagination beyond 10 pages / 300 events
    // and doesn't support `since`. We fetch the first page (30 events).
    return this.get<GitHubUserEvent[]>(`/users/${username}/events?per_page=30`);
  }

  async markThreadAsRead(threadId: string): Promise<void> {
    await this.request(`/notifications/threads/${threadId}`, {
      method: "PATCH",
    });
  }

  getRateLimit(): RateLimitInfo | null {
    return this.lastRateLimit;
  }

  // --- Private helpers ---

  private async request(path: string, init?: RequestInit): Promise<Response> {
    await this.waitForRateLimit();

    const url = path.startsWith("https://") ? path : `${GITHUB_API_BASE}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        ...init?.headers,
      },
    });

    this.updateRateLimit(response);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub API error: ${String(response.status)} ${response.statusText} — ${body}`,
      );
    }

    return response;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return response.json() as Promise<T>;
  }

  private async paginatedGet<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = path;

    while (nextUrl) {
      const response = await this.request(nextUrl);
      const page = (await response.json()) as T[];
      results.push(...page);
      nextUrl = this.parseNextLink(response.headers.get("Link"));
    }

    return results;
  }

  private parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
    return match?.[1] ?? null;
  }

  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const limit = response.headers.get("X-RateLimit-Limit");
    const reset = response.headers.get("X-RateLimit-Reset");
    if (remaining && limit && reset) {
      this.lastRateLimit = {
        remaining: Number.parseInt(remaining, 10),
        limit: Number.parseInt(limit, 10),
        reset: Number.parseInt(reset, 10),
      };
    }
  }

  private async waitForRateLimit(): Promise<void> {
    if (!this.lastRateLimit) return;
    if (this.lastRateLimit.remaining > LOW_RATE_LIMIT_THRESHOLD) return;

    const now = Math.floor(Date.now() / 1000);
    const waitSeconds = this.lastRateLimit.reset - now;
    if (waitSeconds > 0 && waitSeconds < 300) {
      // Wait up to 5 minutes for rate limit reset
      console.log(
        `[ghd] Rate limit low (${String(this.lastRateLimit.remaining)} remaining), waiting ${String(waitSeconds)}s for reset`,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, waitSeconds * 1000);
      });
    }
  }
}
