import { describe, expect, it } from "vitest";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";
import { applyOrganization } from "@marksweep/core/conversation/result";
import { createPageTools } from "@marksweep/core/conversation/page-tools";
import { isPublicAddress } from "@marksweep/core/conversation/public-url";
import type { AgentActivity } from "@marksweep/core/conversation/schema";

const bookmarks = parseBookmarkHtml(
  '<DL><DT><A HREF="https://example.com/a" ADD_DATE="123">A</A><DT><A HREF="https://example.com/b">B</A></DL>',
).bookmarks;
const organization = {
  summary: "已整理",
  assignments: bookmarks.map((bookmark) => ({
    id: bookmark.id,
    title: bookmark.title,
    folderPath: ["开发"],
    reason: "技术内容",
  })),
};

describe("organization integrity", () => {
  it("applies sparse follow-up changes while preserving omitted titles and other bookmarks", () => {
    const result = applyOrganization(bookmarks, {
      mode: "patch",
      summary: "调整一个目录",
      assignments: [{ id: bookmarks[0]!.id, folderPath: ["前端", "React"], reason: "按要求" }],
    });
    expect(result.bookmarks[0]).toMatchObject({ title: bookmarks[0]!.title, folderPath: ["前端", "React"] });
    expect(result.bookmarks[1]).toEqual(bookmarks[1]);
    expect(applyOrganization(bookmarks, { mode: "patch", summary: "无需调整", assignments: [] }).bookmarks).toEqual(
      bookmarks,
    );
    expect(() =>
      applyOrganization(bookmarks, {
        mode: "patch",
        summary: "无效",
        assignments: [{ id: "invented", folderPath: [], reason: "无效" }],
      }),
    ).toThrow();
  });
  it("preserves stable IDs, URLs and attributes across rounds without mutating inputs", () => {
    const first = applyOrganization(bookmarks, organization);
    const second = applyOrganization(first.bookmarks, {
      ...organization,
      assignments: organization.assignments.map((item) => ({
        ...item,
        title: `新${item.title}`,
        folderPath: ["前端"],
      })),
    });
    expect(second.bookmarks[0]).toMatchObject({
      id: bookmarks[0]!.id,
      url: bookmarks[0]!.url,
      attributes: { add_date: "123" },
      title: "新A",
      folderPath: ["前端"],
    });
    expect(bookmarks[0]!.folderPath).toEqual([]);
  });
  it("rejects missing, duplicated and invented IDs before applying any changes", () => {
    for (const assignments of [
      organization.assignments.slice(1),
      [organization.assignments[0], organization.assignments[0]],
      [...organization.assignments, { ...organization.assignments[0], id: "invented" }],
    ])
      expect(() => applyOrganization(bookmarks, { ...organization, assignments })).toThrow();
  });
});

describe("batch evidence tools", () => {
  it("shares the crawl queue across independent parallel tool calls", async () => {
    let active = 0;
    let maximum = 0;
    const tools = createPageTools(bookmarks, {
      signal: new AbortController().signal,
      maxPages: 2,
      cache: new Map(),
      emit: () => undefined,
      crawl: async (urls, _signal, onPage) => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        urls.forEach((url) => onPage({ url, content: "正文" }));
        active--;
      },
    });
    await Promise.all(
      bookmarks.map((bookmark) => tools[0].invoke({ items: [{ bookmarkId: bookmark.id, question: "用途" }] })),
    );
    expect(maximum).toBe(1);
  });
  it("deduplicates parallel calls, reuses evidence, enforces a shared budget and supports reading more", async () => {
    const calls: string[][] = [];
    const events: AgentActivity[] = [];
    const tools = createPageTools(bookmarks, {
      signal: new AbortController().signal,
      maxPages: 1,
      cache: new Map(),
      emit: (activity) => events.push(activity),
      crawl: async (urls, _signal, onPage) => {
        calls.push(urls);
        await Promise.resolve();
        urls.forEach((url) => onPage({ url, content: "x".repeat(9000) }));
      },
    });
    const items = [{ bookmarkId: bookmarks[0]!.id, question: "用途？" }];
    const results = await Promise.all([tools[0]!.invoke({ items }), tools[0]!.invoke({ items })]);
    expect(calls).toEqual([[bookmarks[0]!.url]]);
    expect(String(results[0])).toContain('"truncated":true');
    expect(String(results[1])).toContain("xxxxx");
    const limited = await tools[0]!.invoke({ items: [{ bookmarkId: bookmarks[1]!.id, question: "用途？" }] });
    expect(String(limited)).toContain("采集上限");
    expect(String(await tools[1]!.invoke({ bookmarkId: bookmarks[0]!.id, offset: 5000 }))).toContain('"hasMore":false');
    expect(
      events.filter((event) => event.kind === "tool").map((event) => event.kind === "tool" && event.status),
    ).toEqual(["running", "complete"]);
    await expect(tools[0]!.invoke({ items: [{ bookmarkId: "invented", question: "用途？" }] })).rejects.toThrow(
      "未知书签",
    );
  });
  it("retains partial failures and propagates cancellation", async () => {
    const controller = new AbortController();
    const tools = createPageTools(bookmarks, {
      signal: controller.signal,
      maxPages: 2,
      cache: new Map(),
      emit: () => undefined,
      crawl: async (urls, _signal, onPage) => {
        onPage({ url: urls[0]!, content: "正文" });
        onPage({ url: urls[1]!, error: "403" });
      },
    });
    const result = await tools[0]!.invoke({
      items: bookmarks.map((bookmark) => ({ bookmarkId: bookmark.id, question: "用途" })),
    });
    expect(String(result)).toContain("正文");
    expect(String(result)).toContain("403");
    controller.abort(new Error("用户停止"));
    await expect(tools[0]!.invoke({ items: [{ bookmarkId: bookmarks[0]!.id, question: "用途" }] })).rejects.toThrow(
      "用户停止",
    );
  });
  it("blocks private and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.1.1",
      "192.168.1.1",
      "100.64.0.1",
      "::1",
      "fc00::1",
      "::ffff:127.0.0.1",
    ])
      expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });
});
