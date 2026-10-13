import { randomUUID } from "node:crypto";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pLimit from "p-limit";
import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import type { AgentActivity } from "./schema.js";
import { crawlPages, type PageEvidence } from "./crawler.js";

export type PageCache = Map<string, PageEvidence>;
interface EvidenceRequest {
  bookmarkId: string;
  url: string;
  question: string;
  sourceUrl?: string;
  depth: number;
}

export function createPageTools(
  bookmarks: ExtractedBookmark[],
  options: {
    maxPages: number;
    signal: AbortSignal;
    cache: PageCache;
    emit: (activity: AgentActivity) => void;
    crawl?: typeof crawlPages;
  },
) {
  const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const pending = new Map<string, Promise<PageEvidence>>();
  const depths = new Map(bookmarks.map(({ id, url }) => [id, new Map([[url, 0]])]));
  const expanded = new Map<string, Set<string>>();
  // 多个工具共用采集队列和预算，每批内部最多四个并发。
  const crawlQueue = pLimit(1);
  let fetched = 0;
  const cachedPage = (url: string) =>
    options.cache.get(url) ?? [...options.cache.values()].find((page) => page.finalUrl === url);
  const bookmarkFor = (id: string) => {
    const bookmark = byId.get(id);
    if (!bookmark) throw new Error(`未知书签 ID：${id}`);
    return bookmark;
  };
  const collect = async (selected: EvidenceRequest[]) => {
    options.signal.throwIfAborted();
    const fresh = new Map<string, (value: PageEvidence) => void>();
    const started = performance.now();
    for (const { url } of selected) {
      if (cachedPage(url) || pending.has(url) || !/^https?:\/\//i.test(url) || fetched >= options.maxPages) continue;
      fetched++;
      pending.set(url, new Promise((resolve) => fresh.set(url, resolve)));
    }
    if (fresh.size) {
      const emitPage = (url: string, page?: PageEvidence) => {
        const item = selected.find((item) => item.url === url)!;
        options.emit({
          kind: "tool",
          id: `page:${url}`,
          name: "读取网页",
          status: page ? (page.error ? "error" : "complete") : "running",
          text: `${item.question}\n${page?.error || page?.title || url}${page?.timings ? `\n末次请求与解析 ${page.timings.requestMs}ms · Markdown 转换 ${page.timings.conversionMs}ms · 尝试 ${page.timings.attempts} 次` : ""}`,
          url,
          sourceUrl: item.sourceUrl,
          ...(page ? { elapsedMs: Math.round(performance.now() - started) } : {}),
        });
      };
      const complete = (page: PageEvidence) => {
        const resolve = fresh.get(page.url);
        if (!resolve) return;
        if (!page.error) {
          if (options.cache.size >= 100) options.cache.delete(options.cache.keys().next().value!);
          options.cache.set(page.url, page);
        }
        resolve(page);
        fresh.delete(page.url);
        emitPage(page.url, page);
      };
      for (const url of fresh.keys()) emitPage(url);
      try {
        await crawlQueue(async () => {
          options.signal.throwIfAborted();
          await (options.crawl ?? crawlPages)([...fresh.keys()], options.signal, complete);
        });
      } finally {
        for (const url of [...fresh.keys()]) complete({ url, error: "未取得正文；不能据此判断内容失效。" });
      }
    }
    options.signal.throwIfAborted();
    return JSON.stringify(
      await Promise.all(
        selected.map(async (item) => {
          const page = cachedPage(item.url) ?? (await pending.get(item.url));
          if (page?.content && !page.error) {
            const known = depths.get(item.bookmarkId)!;
            known.set(item.url, Math.min(known.get(item.url) ?? item.depth, item.depth));
            if (page.finalUrl) known.set(page.finalUrl, Math.min(known.get(page.finalUrl) ?? item.depth, item.depth));
          }
          return {
            bookmarkId: item.bookmarkId,
            question: item.question,
            sourceUrl: item.sourceUrl,
            depth: item.depth,
            ...(page ?? { url: item.url, error: "已达本轮采集上限，或不是网页链接。" }),
            content: page?.content?.slice(0, 5000),
            truncated: Boolean(page?.truncated || (page?.content?.length ?? 0) > 5000),
          };
        }),
      ),
    );
  };
  const inspect = tool(
    ({ items }) => collect(items.map((item) => ({ ...item, url: bookmarkFor(item.bookmarkId).url, depth: 0 }))),
    {
      name: "inspect_bookmarks",
      description: "元数据不足时批量读取书签，核实具体疑问。返回 Markdown 正文、参考链接或逐项失败。",
      schema: z.object({
        items: z
          .array(z.object({ bookmarkId: z.string(), question: z.string().min(1).max(500) }))
          .min(1)
          .max(8),
      }),
    },
  );
  const read = tool(
    ({ bookmarkId, url, offset }) => {
      options.signal.throwIfAborted();
      const target = url ?? bookmarkFor(bookmarkId).url;
      if (!depths.get(bookmarkId)?.has(target)) throw new Error("只能继续阅读本书签已取得的证据页面。");
      const page = cachedPage(target);
      return JSON.stringify(
        page
          ? {
              ...page,
              content: page.content?.slice(offset, offset + 5000),
              offset,
              hasMore: (page.content?.length ?? 0) > offset + 5000,
            }
          : { error: "尚未采集，请先读取该网页。" },
      );
    },
    {
      name: "read_cached_page",
      description: "继续读取已缓存的书签或补充页面，不重复请求网页。补充页面须传 url。",
      schema: z.object({
        bookmarkId: z.string(),
        url: z.string().optional(),
        offset: z.number().int().min(0).max(16000),
      }),
    },
  );
  const status = tool(
    ({ message }) => {
      options.emit({ kind: "status", id: randomUUID(), text: message });
      return "进度已展示，请继续工作。";
    },
    {
      name: "report_progress",
      description: "向用户说明简短计划、已确认的事实或下一步行动，不输出内部推理。",
      schema: z.object({ message: z.string().min(1).max(1000) }),
    },
  );
  const external = tool(
    ({ items }) => {
      options.signal.throwIfAborted();
      const selected = items.map((item) => {
        bookmarkFor(item.bookmarkId);
        const depth = depths.get(item.bookmarkId)?.get(item.sourceUrl);
        if (depth === undefined || !cachedPage(item.sourceUrl)?.content)
          throw new Error("补充阅读必须关联本书签已成功读取的来源页面。");
        if (depth >= 2) throw new Error("最多补充阅读两层，请依据已有证据整理或标记待复核。");
        const target = new URL(item.url);
        if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
          throw new Error("只允许不含账号密码的公开 HTTP(S) 页面。");
        target.hash = "";
        const url = target.href;
        const visited = expanded.get(item.bookmarkId) ?? new Set<string>();
        if (!visited.has(url) && visited.size >= 3) throw new Error("每个书签最多尝试三个补充页面。");
        visited.add(url);
        expanded.set(item.bookmarkId, visited);
        return { ...item, url, depth: depth + 1 };
      });
      return collect(selected);
    },
    {
      name: "read_pages",
      description:
        "原文章仍不足以判断时，批量查阅其引用、官网或其他相关公开页面。必须提供书签 ID、已读来源 URL 和具体疑问；最多两层、每书签三个补充页面，与原文章共享本轮预算。仅收集证据，不新增书签；此工具不提供搜索引擎。",
      schema: z.object({
        items: z
          .array(
            z.object({
              bookmarkId: z.string(),
              sourceUrl: z.string().url(),
              url: z.string().url(),
              question: z.string().min(1).max(500),
            }),
          )
          .min(1)
          .max(8),
      }),
    },
  );
  return [inspect, read, status, external] as const;
}
