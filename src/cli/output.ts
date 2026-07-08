import chalk from "chalk";
import type { DeduplicationResult } from "../bookmarks/dedupe.js";
import type { BookmarkCheckResult, BookmarkCheckSummary } from "../checker/types.js";
import type { LangSmithConfig } from "../observability/langsmith.js";
import type { ParsedBookmarkHtml } from "../parser/bookmark-html.js";
import type { AiConfig, BookmarkInputFile, DetectionOptions } from "./config.js";
import { maskSecret } from "./config.js";

export function printParsedSummary(parsed: ParsedBookmarkHtml, inputFile: BookmarkInputFile): void {
  const webBookmarks = parsed.bookmarks.filter((bookmark) => bookmark.isWebUrl);
  const nonWebBookmarks = parsed.bookmarks.length - webBookmarks.length;

  console.log(chalk.bold("书签文件"));
  console.log(`  路径：${inputFile.absolutePath}`);
  console.log(`  标题：${parsed.rootTitle}`);
  console.log("");
  console.log(chalk.bold("提取结果"));
  console.log(`  书签总数：${parsed.bookmarks.length}`);
  console.log(`  文件夹数：${parsed.folders.length}`);
  console.log(`  网页链接：http/https ${webBookmarks.length}`);
  console.log(`  非网页协议：${nonWebBookmarks}`);

  const topLevelFolders = summarizeTopLevelFolders(parsed);
  if (topLevelFolders.length > 0) {
    console.log("");
    console.log(chalk.bold("一级目录"));
    for (const [folder, count] of topLevelFolders) {
      console.log(`  ${folder}：${count}`);
    }
  }
}

export function printDetectionOptions(options: DetectionOptions): void {
  console.log("");
  console.log(chalk.bold("检测参数"));
  console.log(`  并发：${options.concurrency}`);
  console.log(`  超时：${options.timeout}ms`);
  console.log(`  重试：${options.retries}`);
}

export function printDeduplicationSummary(result: DeduplicationResult): void {
  const removedCount = result.duplicates.reduce((sum, group) => sum + group.removed.length, 0);

  console.log("");
  console.log(chalk.bold("去重结果"));
  console.log(`  保留书签：${result.bookmarks.length}`);
  console.log(`  重复分组：${result.duplicates.length}`);
  console.log(`  移除重复：${removedCount}`);
}

export function printCheckSummary(summary: BookmarkCheckSummary): void {
  console.log("");
  console.log(chalk.bold("检测结果"));
  console.log(`  有效：${summary.valid}`);
  console.log(`  明确无效：${summary.broken}`);
  console.log(`  可疑保留：${summary.suspicious}`);
  console.log(`  跳过检测：${summary.skipped}`);

  if (summary.networkMayBeUnreliable) {
    console.log(chalk.yellow("  本次检测出现大面积网络类失败，结果可能不可靠。"));
  }
}

export function printCheckResultList(title: string, results: BookmarkCheckResult[], limit = 20): void {
  if (results.length === 0) {
    return;
  }

  console.log("");
  console.log(chalk.bold(title));

  for (const result of results.slice(0, limit)) {
    const status = result.httpStatus ? `HTTP ${result.httpStatus}` : result.reason;
    console.log(`  - ${result.bookmark.title} <${result.bookmark.url}> (${status})`);
  }

  if (results.length > limit) {
    console.log(`  ... 还有 ${results.length - limit} 条`);
  }
}

export function printOutputTarget(outputPath: string): void {
  console.log("");
  console.log(chalk.bold("输出文件"));
  console.log(`  ${outputPath}`);
}

export function printAiConfig(config: AiConfig): void {
  console.log("");
  console.log(chalk.bold("AI 参数"));
  console.log(`  Base URL：${config.baseUrl}`);
  console.log(`  Model：${config.model}`);
  console.log(`  API Key：${maskSecret(config.apiKey)}`);
  console.log(`  语言：${config.lang}`);
}

export function printLangSmithConfig(config: LangSmithConfig): void {
  console.log("");
  console.log(chalk.bold("LangSmith"));

  if (!config.enabled) {
    console.log("  tracing：关闭");
    return;
  }

  console.log("  tracing：开启");
  console.log(`  project：${config.project}`);
  console.log(`  API Key：${maskSecret(config.apiKey)}`);

  if (config.endpoint) {
    console.log(`  endpoint：${config.endpoint}`);
  }

  if (config.workspaceId) {
    console.log(`  workspace：${config.workspaceId}`);
  }

  console.log(`  隐藏输入：${config.hideInputs ? "是" : "否"}`);
  console.log(`  隐藏输出：${config.hideOutputs ? "是" : "否"}`);
}

export function printPendingPipeline(message: string): void {
  console.log("");
  console.log(chalk.yellow(message));
}

function summarizeTopLevelFolders(parsed: ParsedBookmarkHtml): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const bookmark of parsed.bookmarks) {
    const topLevel = bookmark.folderPath[0] ?? "根目录";
    counts.set(topLevel, (counts.get(topLevel) ?? 0) + 1);
  }

  return [...counts.entries()].sort((first, second) => second[1] - first[1]);
}
