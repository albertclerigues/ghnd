export class GitHubTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubTokenError";
  }
}

/**
 * Resolves a GitHub auth token using the following priority:
 * 1. GHD_GITHUB_TOKEN environment variable
 * 2. `gh auth token` CLI command (requires gh CLI installed and authenticated)
 *
 * Throws GitHubTokenError if no token can be found.
 */
export async function resolveGitHubToken(): Promise<string> {
  // 1. Check environment variable first (explicit config takes priority)
  const envToken = process.env["GHD_GITHUB_TOKEN"];
  if (envToken) {
    return envToken;
  }

  // 2. Try gh CLI
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const token = output.trim();
      if (token.length > 0) {
        return token;
      }
    }
  } catch {
    // gh CLI not installed or not in PATH — fall through
  }

  throw new GitHubTokenError(
    "No GitHub token found. Either set GHD_GITHUB_TOKEN or run `gh auth login`.",
  );
}

/**
 * Resolves the authenticated GitHub username.
 * Called once at startup; the result is cached by the caller.
 */
export async function resolveGitHubUsername(token: string): Promise<string> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new GitHubTokenError(
      `Failed to resolve GitHub username: ${String(response.status)} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as { login: string };
  return data.login;
}
