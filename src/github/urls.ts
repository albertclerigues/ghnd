/**
 * Converts a GitHub API URL to a browser-facing HTML URL.
 * e.g., "https://api.github.com/repos/acme/project/issues/42"
 *     → "https://github.com/acme/project/issues/42"
 */
export function apiUrlToHtmlUrl(apiUrl: string): string {
  return apiUrl.replace("https://api.github.com/repos/", "https://github.com/");
}

export type SubjectKind = "issue" | "pull" | "discussion";

/**
 * Extracts owner, repo, number, and kind from a GitHub API subject URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function parseSubjectUrl(
  apiUrl: string,
): { owner: string; repo: string; number: number; kind: SubjectKind } | null {
  // Matches: https://api.github.com/repos/{owner}/{repo}/issues/{number}
  // Also:    https://api.github.com/repos/{owner}/{repo}/pulls/{number}
  // Also:    https://api.github.com/repos/{owner}/{repo}/discussions/{number}
  const match = /\/repos\/([^/]+)\/([^/]+)\/(issues|pulls|discussions)\/(\d+)$/.exec(apiUrl);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return null;

  const kindMap: Record<string, SubjectKind> = {
    issues: "issue",
    pulls: "pull",
    discussions: "discussion",
  };

  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[4], 10),
    kind: kindMap[match[3]] ?? "issue",
  };
}

/**
 * Extracts owner, repo, and number from a GitHub HTML subject URL.
 * e.g., "https://github.com/acme/project/issues/42"
 *     → { owner: "acme", repo: "project", number: 42 }
 */
export function parseHtmlSubjectUrl(
  htmlUrl: string,
): { owner: string; repo: string; number: number } | null {
  const match = /github\.com\/([^/]+)\/([^/]+)\/(issues|pull|discussions)\/(\d+)/.exec(htmlUrl);
  if (!match?.[1] || !match[2] || !match[4]) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[4], 10),
  };
}
