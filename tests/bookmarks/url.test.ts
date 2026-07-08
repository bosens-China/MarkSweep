import { describe, expect, it } from "vitest";
import { normalizeBookmarkUrl } from "../../src/bookmarks/url";

describe("normalizeBookmarkUrl", () => {
  it("normalizes protocol and host casing", () => {
    expect(normalizeBookmarkUrl("HTTPS://Example.COM/Docs")).toBe("https://example.com/Docs");
  });

  it("removes trailing slashes from root and nested paths", () => {
    expect(normalizeBookmarkUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeBookmarkUrl("https://example.com/docs/")).toBe("https://example.com/docs");
    expect(normalizeBookmarkUrl("https://example.com/docs///")).toBe("https://example.com/docs");
  });

  it("preserves query and hash", () => {
    expect(normalizeBookmarkUrl("https://example.com/docs/?a=1#intro")).toBe("https://example.com/docs?a=1#intro");
  });

  it("keeps non-url values trimmed", () => {
    expect(normalizeBookmarkUrl("  not a url  ")).toBe("not a url");
  });
});
