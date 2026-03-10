import { describe, expect, it } from "bun:test";
import { apiUrlToHtmlUrl, parseSubjectUrl } from "../../src/github/urls.js";

describe("apiUrlToHtmlUrl", () => {
  it("converts API URL to browser URL", () => {
    expect(apiUrlToHtmlUrl("https://api.github.com/repos/acme/project/issues/42")).toBe(
      "https://github.com/acme/project/issues/42",
    );
  });

  it("converts pulls API URL", () => {
    expect(apiUrlToHtmlUrl("https://api.github.com/repos/acme/project/pulls/99")).toBe(
      "https://github.com/acme/project/pulls/99",
    );
  });
});

describe("parseSubjectUrl", () => {
  it("extracts owner/repo/number from issue URL", () => {
    const result = parseSubjectUrl("https://api.github.com/repos/acme/project/issues/42");
    expect(result).toEqual({ owner: "acme", repo: "project", number: 42, kind: "issue" });
  });

  it("extracts from pull URL", () => {
    const result = parseSubjectUrl("https://api.github.com/repos/acme/project/pulls/99");
    expect(result).toEqual({ owner: "acme", repo: "project", number: 99, kind: "pull" });
  });

  it("extracts from discussion URL", () => {
    const result = parseSubjectUrl("https://api.github.com/repos/acme/project/discussions/123");
    expect(result).toEqual({ owner: "acme", repo: "project", number: 123, kind: "discussion" });
  });

  it("returns null for non-matching URLs", () => {
    expect(parseSubjectUrl("https://api.github.com/repos/acme/project/releases/1")).toBeNull();
    expect(parseSubjectUrl("https://example.com")).toBeNull();
  });
});
