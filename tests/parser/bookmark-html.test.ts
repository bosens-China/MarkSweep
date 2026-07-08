import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isWebUrl, parseBookmarkHtml } from "../../src/parser/bookmark-html";

const samplePath = fileURLToPath(new URL("../../bookmarks_2026_7_8.html", import.meta.url));
const sampleHtml = readFileSync(samplePath, "utf8");

describe("parseBookmarkHtml", () => {
  it("extracts bookmarks and folders from a browser bookmark export", () => {
    const parsed = parseBookmarkHtml(sampleHtml);

    expect(parsed.rootTitle).toBe("Bookmarks");
    expect(parsed.bookmarks).toHaveLength(227);
    expect(parsed.folders).toHaveLength(21);
  });

  it("extracts basic bookmark fields and original attributes", () => {
    const { bookmarks } = parseBookmarkHtml(sampleHtml);
    const first = bookmarks[0];

    expect(first).toMatchObject({
      title: "Google",
      url: "https://www.google.com/ncr",
      folderPath: ["书签栏"],
      isWebUrl: true,
    });
    expect(first.attributes.add_date).toBe("1528169886");
    expect(first.attributes.icon).toContain("data:image/png;base64");
  });

  it("keeps nested folder paths in document order", () => {
    const { bookmarks } = parseBookmarkHtml(sampleHtml);
    const cssBookmark = bookmarks.find((bookmark) => bookmark.url === "https://www.cnblogs.com/coco1s/p/9913885.html");

    expect(cssBookmark).toBeDefined();
    expect(cssBookmark?.title).toBe("你所不知道的 CSS 阴影技巧与细节 - ChokCoco - 博客园");
    expect(cssBookmark?.folderPath).toEqual(["书签栏", "收藏文章", "css相关"]);
  });

  it("supports bookmarks placed at the export root", () => {
    const { bookmarks } = parseBookmarkHtml(sampleHtml);
    const rootBookmark = bookmarks.find((bookmark) => bookmark.url === "http://demo.qzhai.net/gohan/");

    expect(rootBookmark).toBeDefined();
    expect(rootBookmark?.title).toBe("衫小小寨 - 又一个WordPress站点");
    expect(rootBookmark?.folderPath).toEqual([]);
  });

  it("extracts folder metadata", () => {
    const { folders } = parseBookmarkHtml(sampleHtml);
    const aiFolder = folders.find((folder) => folder.path.join("/") === "书签栏/AI");

    expect(aiFolder).toBeDefined();
    expect(aiFolder?.title).toBe("AI");
    expect(aiFolder?.attributes.add_date).toBe("1744272261");
    expect(aiFolder?.attributes.last_modified).toBe("1781162922");
  });

  it("marks non-http protocols as non-web URLs", () => {
    const parsed = parseBookmarkHtml(`
      <!DOCTYPE NETSCAPE-Bookmark-file-1>
      <TITLE>Bookmarks</TITLE>
      <H1>Bookmarks</H1>
      <DL><p>
        <DT><H3>工具</H3>
        <DL><p>
          <DT><A HREF="javascript:alert(1)" ADD_DATE="1">脚本</A>
          <DT><A HREF="chrome://settings" ADD_DATE="2">设置</A>
          <DT><A HREF="https://example.com/" ADD_DATE="3">Example</A>
        </DL><p>
      </DL><p>
    `);

    expect(parsed.bookmarks.map((bookmark) => bookmark.isWebUrl)).toEqual([false, false, true]);
  });

  it("throws a clear error for non-bookmark HTML", () => {
    expect(() => parseBookmarkHtml("<html><body>No bookmarks here</body></html>")).toThrow(
      "未找到浏览器书签 HTML 的 <DL> 根节点",
    );
  });
});

describe("isWebUrl", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com", true],
    ["chrome://settings", false],
    ["file:///tmp/bookmark.html", false],
    ["mailto:test@example.com", false],
    ["not a url", false],
  ])("returns %s for %s", (url, expected) => {
    expect(isWebUrl(url)).toBe(expected);
  });
});
