import { describe, expect, it } from "vitest";
import { bookmarkContext, createBookmarkTool } from "@marksweep/core/conversation/bookmark-tools";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";

const bookmarks = parseBookmarkHtml(
  `<DL>${Array.from({ length: 60 }, (_, i) => `<DT><A HREF="https://example.com/${i}">${i < 7 ? "React" : "Vue"} 教程 ${i}</A>`).join("")}</DL>`,
).bookmarks;

describe("targeted follow-up context", () => {
  it("keeps first-round metadata and uses a smaller folder outline for follow-ups", () => {
    expect(bookmarkContext(bookmarks, false)).toContain(bookmarks[0]!.url);
    const context = bookmarkContext(bookmarks, true);
    expect(JSON.parse(context)).toMatchObject({ total: 60, folders: [{ count: 60 }] });
    expect(context).not.toContain(bookmarks[0]!.url);
    expect(context.length).toBeLessThan(bookmarkContext(bookmarks, false).length / 10);
  });
  it("matches any keyword, returns stable IDs, supports complete pagination and cancellation", async () => {
    const controller = new AbortController();
    const tool = createBookmarkTool(bookmarks, controller.signal);
    const selected = JSON.parse(String(await tool.invoke({ keywords: ["REACT", "example.com/59"], offset: 0 })));
    expect(selected.total).toBe(8);
    expect(selected.items[0].id).toBe(bookmarks[0]!.id);
    const first = JSON.parse(String(await tool.invoke({ keywords: [], offset: 0 })));
    const last = JSON.parse(String(await tool.invoke({ keywords: [], offset: first.nextOffset })));
    expect(first.items).toHaveLength(50);
    expect(last.items).toHaveLength(10);
    expect(last.nextOffset).toBeNull();
    controller.abort(new Error("用户停止"));
    await expect(tool.invoke({ keywords: [], offset: 0 })).rejects.toThrow("用户停止");
  });
});
