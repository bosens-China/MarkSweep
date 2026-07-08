import { describe, expect, it } from "vitest";
import { createBookmarkHtmlDocument, moveBookmarksToFolder, renderBookmarkHtml } from "../../src/writer/bookmark-html";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("bookmark HTML writer", () => {
  it("renders a browser-importable Netscape bookmark file", () => {
    const html = renderBookmarkHtml(
      createBookmarkHtmlDocument([
        createBookmark("1", "Example & Docs", "https://example.com/docs", ["Dev", "Docs"], {
          add_date: "1",
        }),
      ]),
    );

    expect(html).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
    expect(html).toContain("<H1>Bookmarks</H1>");
    expect(html).toContain("<DT><H3>Dev</H3>");
    expect(html).toContain("<DT><H3>Docs</H3>");
    expect(html).toContain('<DT><A HREF="https://example.com/docs" ADD_DATE="1">Example &amp; Docs</A>');
  });

  it("keeps root bookmarks at the root level", () => {
    const html = renderBookmarkHtml(createBookmarkHtmlDocument([createBookmark("1", "Root", "https://root.test", [])]));

    expect(html).toContain('<DT><A HREF="https://root.test">Root</A>');
  });

  it("moves bookmarks into a target folder", () => {
    const moved = moveBookmarksToFolder([createBookmark("1", "Maybe", "https://maybe.test", ["Old"])], "其他");

    expect(moved[0]?.folderPath).toEqual(["其他"]);
  });
});

function createBookmark(
  id: string,
  title: string,
  url: string,
  folderPath: string[],
  attributes: Record<string, string> = {},
): ExtractedBookmark {
  return {
    id,
    title,
    url,
    folderPath,
    attributes: {
      href: url,
      ...attributes,
    },
    isWebUrl: url.startsWith("http"),
  };
}
