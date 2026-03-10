/**
 * Converts a GitHub API URL to a browser-facing HTML URL.
 * e.g., "https://api.github.com/repos/acme/project/issues/42"
 *     → "https://github.com/acme/project/issues/42"
 */
export function apiUrlToHtmlUrl(apiUrl: string): string {
  return apiUrl.replace("https://api.github.com/repos/", "https://github.com/");
}

/**
 * Extracts owner, repo, and issue/PR number from a GitHub API subject URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function parseSubjectUrl(
  apiUrl: string,
): { owner: string; repo: string; number: number } | null {
  // Matches: https://api.github.com/repos/{owner}/{repo}/issues/{number}
  // Also:    https://api.github.com/repos/{owner}/{repo}/pulls/{number}
  const match = /\/repos\/([^/]+)\/([^/]+)\/(?:issues|pulls)\/(\d+)$/.exec(apiUrl);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}
