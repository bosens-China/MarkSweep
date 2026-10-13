import { describe, expect, it } from "vitest";
import { buildFolderTree, inFolder } from "../../apps/web/src/bookmark-view";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";

describe("bookmark workspace folders", () => {
  it("keeps nested folders distinct even when titles contain slashes", () => {
    const [bookmark] = parseBookmarkHtml('<DL><p><DT><A HREF="https://example.com">Example</A></DL>').bookmarks;
    if (!bookmark) throw new Error("missing fixture");
    const books = [
      { ...bookmark, folderPath: ["A/B"] },
      { ...bookmark, folderPath: ["A", "B"] },
    ];
    const tree = buildFolderTree(books);
    expect(tree.map((node) => node.key)).toEqual(['["A/B"]', '["A"]']);
    expect(inFolder(books[1]!, '["A"]')).toBe(true);
    expect(inFolder(books[0]!, '["A"]')).toBe(false);
    expect(inFolder(bookmark, "root")).toBe(true);
  });
});
