import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ExtractedBookmark } from "../parser/bookmark-html.js";

export function bookmarkContext(bookmarks: ExtractedBookmark[], followUp: boolean) {
  if (!followUp)
    return JSON.stringify(bookmarks.map(({ id, title, url, folderPath }) => ({ id, title, url, folderPath })));
  const folders = new Map<string, { folderPath: string[]; count: number }>();
  for (const { folderPath } of bookmarks) {
    const key = JSON.stringify(folderPath);
    const entry = folders.get(key) ?? { folderPath, count: 0 };
    entry.count++;
    folders.set(key, entry);
  }
  return JSON.stringify({
    total: bookmarks.length,
    folders: [...folders.values()],
    note: "先用 find_bookmarks 查询本轮相关书签；全局调整可用空关键词分页遍历。",
  });
}

export function createBookmarkTool(bookmarks: ExtractedBookmark[], signal: AbortSignal) {
  return tool(
    ({ keywords, offset }) => {
      signal.throwIfAborted();
      const terms = keywords.map((word) => word.toLocaleLowerCase());
      const matches = bookmarks.filter(({ title, url, folderPath }) => {
        const text = `${title}\n${url}\n${folderPath.join("/")}`.toLocaleLowerCase();
        return !terms.length || terms.some((term) => text.includes(term));
      });
      return JSON.stringify({
        total: matches.length,
        offset,
        items: matches
          .slice(offset, offset + 50)
          .map(({ id, title, url, folderPath }) => ({ id, title, url, folderPath })),
        nextOffset: offset + 50 < matches.length ? offset + 50 : null,
      });
    },
    {
      name: "find_bookmarks",
      description:
        "在当前书签的标题、URL 和目录中按任一关键词查找，返回完整元数据与 ID。续聊先定位候选；关键词应包括同义表达。空数组匹配全部，超过 50 项用 nextOffset 继续，不得把关键词未命中当作语义上不存在。",
      schema: z.object({
        keywords: z.array(z.string().trim().min(1).max(200)).max(12),
        offset: z.number().int().min(0).default(0),
      }),
    },
  );
}
