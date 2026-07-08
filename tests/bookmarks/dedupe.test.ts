import { describe, expect, it } from "vitest";
import { createDeduplicationReport, dedupeBookmarks, scoreTitle } from "../../src/bookmarks/dedupe";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("dedupeBookmarks", () => {
  it("dedupes by normalized URL and keeps the more informative title", () => {
    const bookmarks = [
      createBookmark("1", "GitHub", "HTTPS://github.com/"),
      createBookmark("2", "GitHub: Let us build from here", "https://github.com"),
      createBookmark("3", "Docs", "https://example.com/docs?a=1#part"),
      createBookmark("4", "Other Docs", "https://example.com/docs?a=1#other"),
    ];

    const result = dedupeBookmarks(bookmarks);

    expect(result.bookmarks.map((bookmark) => bookmark.id)).toEqual(["2", "3", "4"]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.normalizedUrl).toBe("https://github.com");
    expect(result.duplicates[0]?.removed.map((bookmark) => bookmark.id)).toEqual(["1"]);
  });

  it("returns a compact deduplication report", () => {
    const result = dedupeBookmarks([
      createBookmark("1", "首页", "https://example.com/"),
      createBookmark("2", "Example Domain", "https://example.com"),
    ]);

    expect(createDeduplicationReport(result)).toEqual({
      keptCount: 1,
      duplicateGroupCount: 1,
      removedCount: 1,
    });
  });
});

describe("scoreTitle", () => {
  it("penalizes weak generic titles", () => {
    expect(scoreTitle("Example Domain")).toBeGreaterThan(scoreTitle("首页"));
    expect(scoreTitle("TypeScript Handbook")).toBeGreaterThan(scoreTitle("Untitled"));
  });
});

function createBookmark(id: string, title: string, url: string): ExtractedBookmark {
  return {
    id,
    title,
    url,
    folderPath: [],
    attributes: {
      href: url,
    },
    isWebUrl: url.startsWith("http"),
  };
}
