import { z } from "zod";
import { summarizeCheckResults } from "../checker/summary.js";
import type { BookmarkCheckResult, BookmarkCheckSummary } from "../checker/types.js";
import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import { normalizeBookmarkUrl } from "../bookmarks/url.js";
import { checkResultSchema } from "../protocol.js";

export interface CheckReportFile {
  version: 1;
  generatedAt: string;
  inputPath: string;
  summary: BookmarkCheckSummary;
  results: BookmarkCheckResult[];
}

export function createCheckReport(inputPath: string, results: BookmarkCheckResult[]): CheckReportFile {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    summary: summarizeCheckResults(results),
    results,
  };
}

export function stringifyCheckReport(report: CheckReportFile): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function parseCheckReport(value: unknown): CheckReportFile {
  const parsed = z
    .object({
      version: z.literal(1),
      generatedAt: z.string().refine((date) => Number.isFinite(Date.parse(date))),
      inputPath: z.string(),
      results: z.array(checkResultSchema).max(50000),
    })
    .safeParse(value);
  if (!parsed.success) throw new Error("检测报告格式无效，请导入 MarkSweep 生成的 JSON 报告。");
  return { ...parsed.data, summary: summarizeCheckResults(parsed.data.results) };
}

export function matchCheckReport(bookmarks: ExtractedBookmark[], report: CheckReportFile): BookmarkCheckResult[] {
  const byUrl = new Map<string, BookmarkCheckResult>();
  const add = (url: string, result: BookmarkCheckResult) => {
    const key = normalizeBookmarkUrl(url);
    const previous = byUrl.get(key);
    if (previous && (previous.status !== result.status || previous.reason !== result.reason)) {
      throw new Error("报告包含同一 URL 的冲突结果，请重新检测。");
    }
    byUrl.set(key, result);
  };
  for (const result of report.results) {
    add(result.bookmark.url, result);
    if (result.reason === "https_upgrade") {
      const original = new URL(result.bookmark.url);
      if (original.protocol !== "https:") throw new Error("报告中的 HTTPS 升级结果无效。");
      original.protocol = "http:";
      add(original.href, result);
    }
  }
  return bookmarks.flatMap((bookmark) => {
    const result = byUrl.get(normalizeBookmarkUrl(bookmark.url));
    if (!result) return [];
    const current = result.reason === "https_upgrade" ? { ...bookmark, url: result.bookmark.url } : bookmark;
    return [{ ...result, bookmark: current }];
  });
}
