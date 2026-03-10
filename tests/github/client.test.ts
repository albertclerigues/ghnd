import { describe, expect, it } from "bun:test";
import { FixtureGitHubClient } from "../helpers/github.js";

describe("FixtureGitHubClient.getIssueDetails", () => {
  it("returns fixture data for issue #42", async () => {
    const client = new FixtureGitHubClient();
    const details = await client.getIssueDetails("acme", "project", 42);
    expect(details.number).toBe(42);
    expect(details.title).toBe("Fix widget rendering in dark mode");
    expect(details.body).toContain("dark mode");
  });

  it("returns fixture data for PR #99", async () => {
    const client = new FixtureGitHubClient();
    const details = await client.getIssueDetails("acme", "project", 99);
    expect(details.number).toBe(99);
    expect(details.body).toContain("LRU cache");
  });

  it("throws for unknown issue", async () => {
    const client = new FixtureGitHubClient();
    expect(client.getIssueDetails("unknown", "repo", 1)).rejects.toThrow("Fixture not found");
  });
});
