import { describe, expect, it } from "bun:test";
import { GitHubTokenError, resolveGitHubToken } from "../../src/github/token.js";

describe("resolveGitHubToken", () => {
  it("returns env var when GHD_GITHUB_TOKEN is set", async () => {
    const original = process.env["GHD_GITHUB_TOKEN"];
    try {
      process.env["GHD_GITHUB_TOKEN"] = "test-token-123";
      const token = await resolveGitHubToken();
      expect(token).toBe("test-token-123");
    } finally {
      if (original !== undefined) {
        process.env["GHD_GITHUB_TOKEN"] = original;
      } else {
        delete process.env["GHD_GITHUB_TOKEN"];
      }
    }
  });

  it("env var takes priority over gh CLI", async () => {
    const original = process.env["GHD_GITHUB_TOKEN"];
    try {
      process.env["GHD_GITHUB_TOKEN"] = "env-token";
      const token = await resolveGitHubToken();
      // Should return env var, not gh CLI token
      expect(token).toBe("env-token");
    } finally {
      if (original !== undefined) {
        process.env["GHD_GITHUB_TOKEN"] = original;
      } else {
        delete process.env["GHD_GITHUB_TOKEN"];
      }
    }
  });

  it("falls back to gh CLI when env var is not set", async () => {
    const original = process.env["GHD_GITHUB_TOKEN"];
    try {
      delete process.env["GHD_GITHUB_TOKEN"];
      // On this machine gh is installed and authenticated, so this should succeed
      const token = await resolveGitHubToken();
      expect(token.length).toBeGreaterThan(0);
    } finally {
      if (original !== undefined) {
        process.env["GHD_GITHUB_TOKEN"] = original;
      } else {
        delete process.env["GHD_GITHUB_TOKEN"];
      }
    }
  });

  it("GitHubTokenError has correct name", () => {
    const error = new GitHubTokenError("test");
    expect(error.name).toBe("GitHubTokenError");
    expect(error.message).toBe("test");
    expect(error).toBeInstanceOf(Error);
  });
});
