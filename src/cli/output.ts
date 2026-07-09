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
  console.log(`  网页链接（HTTP/HTTPS）：${webBookmarks.length}`);
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
  console.log(`  超时：${options.timeout} ms`);
  console.log(`  重试次数：${options.retries}`);
}

export function printDeduplicationSummary(result: DeduplicationResult): void {
  const removedCount = result.duplicates.reduce((sum, group) => sum + group.removed.length, 0);

  console.log("");
  console.log(chalk.bold("去重结果"));
  console.log(`  保留书签：${result.bookmarks.length}`);
  console.log(`  重复分组：${result.duplicates.length}`);
  console.log(`  移除重复项：${removedCount}`);
}

export function printCheckSummary(summary: BookmarkCheckSummary): void {
  console.log("");
  console.log(chalk.bold("检测结果"));
  console.log(`  ${chalk.green("有效")}：${summary.valid}`);
  console.log(`  ${chalk.red("明确无效")}：${summary.broken}`);
  console.log(`  ${chalk.yellow("可疑（保留）")}：${summary.suspicious}`);
  console.log(`  ${chalk.gray("跳过检测")}：${summary.skipped}`);

  if (summary.networkMayBeUnreliable) {
    console.log(chalk.yellow("  本次检测出现大量网络类失败，结果可能不可靠。"));
  }
}

export function printCheckResultList(title: string, results: BookmarkCheckResult[]): void {
  if (results.length === 0) {
    return;
  }

  console.log("");
  console.log(chalk.bold(colorByStatus(results[0]?.status, title)));

  for (const [key, group] of groupCheckResults(results)) {
    const description = describeResultGroup(group[0]);
    console.log(`  ${colorByStatus(group[0]?.status, key)}：${group.length} 条`);
    if (description) {
      console.log(`    ${description}`);
    }
    console.log("");

    for (const result of group) {
      console.log(`    - ${result.bookmark.title}  ${result.bookmark.url}`);
    }
  }
}

export function printCheckResultGroupDescriptions(title: string, results: BookmarkCheckResult[]): void {
  if (results.length === 0) {
    return;
  }

  console.log("");
  console.log(chalk.bold(colorByStatus(results[0]?.status, title)));

  for (const [key, group] of groupCheckResults(results)) {
    const description = describeResultGroup(group[0]);
    console.log(`  ${colorByStatus(group[0]?.status, key)}：${group.length} 条`);
    if (description) {
      console.log(`    ${description}`);
    }
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
  console.log(`  模型：${config.model}`);
  console.log(`  API Key：${maskSecret(config.apiKey)}`);
  console.log(`  语言：${config.lang}`);
}

export function printLangSmithConfig(config: LangSmithConfig): void {
  console.log("");
  console.log(chalk.bold("LangSmith"));

  if (!config.enabled) {
    console.log("  追踪：关闭");
    return;
  }

  console.log("  追踪：开启");
  console.log(`  项目：${config.project}`);
  console.log(`  API Key：${maskSecret(config.apiKey)}`);

  if (config.endpoint) {
    console.log(`  Endpoint：${config.endpoint}`);
  }

  if (config.workspaceId) {
    console.log(`  Workspace：${config.workspaceId}`);
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

function groupCheckResults(results: BookmarkCheckResult[]): Array<[string, BookmarkCheckResult[]]> {
  const groups = new Map<string, BookmarkCheckResult[]>();

  for (const result of results) {
    const key = result.httpStatus ? `HTTP ${result.httpStatus}` : result.reason;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }

  return [...groups.entries()];
}

function describeResultGroup(result: BookmarkCheckResult | undefined): string {
  if (!result) {
    return "";
  }

  if (result.httpStatus === 401) {
    return "需要认证或登录，当前检测请求没有有效登录态。";
  }

  if (result.httpStatus === 403) {
    return "服务器拒绝访问，可能需要权限、登录态，或触发了防爬。";
  }

  if (result.httpStatus === 404) {
    return "服务器明确表示这个具体页面不存在。";
  }

  if (result.httpStatus === 410) {
    return "服务器明确表示这个页面已永久移除。";
  }

  if (result.httpStatus === 429) {
    return "请求过多被限流，稍后或用浏览器访问可能不同。";
  }

  if (result.httpStatus === 502) {
    return "网关收到上游错误，浏览器通常也会显示无法正常运作。";
  }

  switch (result.reason) {
    case "dns_not_found":
      return "域名无法解析。";
    case "connection_refused":
      return "目标服务器拒绝连接。";
    case "empty_response":
      return "连接被提前关闭，浏览器常见为 ERR_CONNECTION_CLOSED。";
    case "timeout":
      return "加长超时确认后仍无响应。";
    case "protocol_error":
      return "HTTP 协议协商失败，浏览器常见为 ERR_HTTP2_PROTOCOL_ERROR。";
    case "ssl_error":
      return "证书或 TLS 校验失败。";
    case "non_web_url":
      return "非 HTTP/HTTPS 协议，已跳过网络检测。";
    case "https_upgrade":
      return "原 HTTP 地址失败，但 HTTPS 地址可访问。";
    default:
      return "";
  }
}

function colorByStatus(status: BookmarkCheckResult["status"] | undefined, text: string): string {
  switch (status) {
    case "valid":
      return chalk.green(text);
    case "broken":
      return chalk.red(text);
    case "suspicious":
      return chalk.yellow(text);
    case "skipped":
      return chalk.gray(text);
    default:
      return text;
  }
}
