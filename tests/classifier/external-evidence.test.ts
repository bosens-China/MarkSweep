import { describe, expect, it } from "vitest";
import { createPageTools, type PageCache } from "@marksweep/core/conversation/page-tools";
import { crawlPages } from "@marksweep/core/conversation/crawler";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";
import type { AgentActivity } from "@marksweep/core/conversation/schema";

const bookmarks = parseBookmarkHtml('<DL><DT><A HREF="https://example.com/article">文章</A></DL>').bookmarks;
const bookmark = bookmarks[0]!;
function setup(maxPages = 10) {
  const calls: string[][] = [];
  const events: AgentActivity[] = [];
  const cache: PageCache = new Map();
  const controller = new AbortController();
  const tools = createPageTools(bookmarks, {
    maxPages,
    cache,
    signal: controller.signal,
    emit: (event) => events.push(event),
    crawl: async (urls, _signal, onPage) => {
      calls.push(urls);
      await Promise.resolve();
      for (const url of urls) onPage({ url, content: "正文".repeat(3000), contentFormat: "markdown" });
    },
  });
  const inspect = () => tools[0].invoke({ items: [{ bookmarkId: bookmark.id, question: "文章用途" }] });
  const read = (url: string, sourceUrl = bookmark.url) =>
    tools[3].invoke({ items: [{ bookmarkId: bookmark.id, sourceUrl, url, question: "核实技术归属" }] });
  return { tools, read, inspect, calls, events, cache, controller };
}

describe("bounded external evidence", () => {
  it("requires a successfully read source, batches cross-site evidence and reuses cache", async () => {
    const state = setup();
    await expect(state.read("https://official.example/reference")).rejects.toThrow("已成功读取");
    await state.inspect();
    const items = ["https://official.example/reference", "https://other.example/details"].map((url) => ({
      bookmarkId: bookmark.id,
      url,
      sourceUrl: bookmark.url,
      question: "明确疑问",
    }));
    await Promise.all([state.tools[3].invoke({ items }), state.tools[3].invoke({ items })]);
    expect(state.calls).toEqual([[bookmark.url], items.map((item) => item.url)]);
    expect(state.events).toContainEqual(
      expect.objectContaining({
        kind: "tool",
        sourceUrl: bookmark.url,
        url: items[0]!.url,
        status: "complete",
        elapsedMs: expect.any(Number),
      }),
    );
    expect(
      String(await state.tools[1].invoke({ bookmarkId: bookmark.id, url: items[0]!.url, offset: 5000 })),
    ).toContain('"hasMore":false');
    expect(bookmarks).toHaveLength(1);
    expect(bookmark.url).toBe("https://example.com/article");
  });
  it("accepts a validated redirect destination as the source and reuses its cached body", async () => {
    const state = setup();
    state.cache.set(bookmark.url, { url: bookmark.url, finalUrl: "https://example.com/moved", content: "正文" });
    await state.inspect();
    await state.read("https://official.example/reference", "https://example.com/moved");
    expect(state.calls).toEqual([["https://official.example/reference"]]);
    expect(
      String(await state.tools[1].invoke({ bookmarkId: bookmark.id, url: "https://example.com/moved", offset: 0 })),
    ).toContain("正文");
  });
  it("enforces two expansion levels and three supplemental attempts", async () => {
    const state = setup();
    await state.inspect();
    await state.read("https://official.example/first");
    await state.read("https://official.example/second", "https://official.example/first");
    await expect(state.read("https://official.example/third", "https://official.example/second")).rejects.toThrow(
      "两层",
    );
    await state.read("https://other.example/third");
    await expect(state.read("https://other.example/fourth")).rejects.toThrow("三个");
  });
  it("shares the original page budget, validates URLs and propagates cancellation", async () => {
    const state = setup(1);
    await state.inspect();
    expect(String(await state.read("https://other.example/reference"))).toContain("采集上限");
    expect(state.calls).toHaveLength(1);
    await expect(state.read("file:///etc/passwd")).rejects.toThrow("HTTP(S)");
    await expect(state.read("https://user:secret@other.example/")).rejects.toThrow("HTTP(S)");
    await expect(
      state.tools[1].invoke({ bookmarkId: bookmark.id, url: "https://unread.example/", offset: 0 }),
    ).rejects.toThrow("已取得");
    state.controller.abort(new Error("用户停止"));
    await expect(state.read("https://other.example/reference")).rejects.toThrow("用户停止");
  });
  it("rejects local and non-web URLs in the real crawler before opening a queue", async () => {
    const errors: string[] = [];
    await crawlPages(
      ["http://127.0.0.1/", "http://[::1]/", "file:///etc/passwd"],
      new AbortController().signal,
      (page) => errors.push(page.error ?? ""),
    );
    expect(errors).toHaveLength(3);
    expect(errors.every(Boolean)).toBe(true);
  });
});
