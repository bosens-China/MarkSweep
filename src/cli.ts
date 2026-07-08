#!/usr/bin/env node
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { config as loadDotEnv } from "dotenv";
import ora from "ora";
import { dedupeBookmarks } from "./bookmarks/dedupe.js";
import { checkBookmarks, summarizeCheckResults } from "./checker/bookmark-checker.js";
import { classifyBookmarks } from "./classifier/bookmark-classifier.js";
import {
  createLangSmithRuntime,
  flushLangSmithRuntime,
  resolveLangSmithConfig,
  type RawLangSmithOptions,
} from "./observability/langsmith.js";
import { getBrokenResults, getKeptResults, getSuspiciousResults } from "./report/check-report.js";
import { parseBookmarkHtml } from "./parser/bookmark-html.js";
import {
  assertWritableOutputPath,
  parseNonNegativeInteger,
  parsePositiveInteger,
  readBookmarkHtmlFile,
  resolveAiConfig,
  resolveOutputPath,
  resolveWebPageFetcherConfig,
  type DetectionOptions,
  type RawAiOptions,
} from "./cli/config.js";
import {
  printAiConfig,
  printCheckResultList,
  printCheckSummary,
  printDeduplicationSummary,
  printDetectionOptions,
  printLangSmithConfig,
  printOutputTarget,
  printParsedSummary,
} from "./cli/output.js";
import { createBookmarkHtmlDocument, moveBookmarksToFolder, renderBookmarkHtml } from "./writer/bookmark-html.js";
import type { BookmarkCheckResult } from "./checker/types.js";
import type { ExtractedBookmark } from "./parser/bookmark-html.js";
import type { BookmarkHtmlDocument } from "./writer/bookmark-html.js";

loadDotEnv({ quiet: true });

interface OutputOption {
  output?: string;
}

type CheckOptions = DetectionOptions;
type CleanOptions = DetectionOptions & OutputOption;
type ClassifyOptions = DetectionOptions & RawAiOptions & RawLangSmithOptions & OutputOption;

interface CliDependencies {
  checkBookmarks: typeof checkBookmarks;
  classifyBookmarks: typeof classifyBookmarks;
}

const defaultDependencies: CliDependencies = {
  checkBookmarks,
  classifyBookmarks,
};

export function createProgram(dependencies: CliDependencies = defaultDependencies): Command {
  const program = new Command();

  program
    .name("marksweep")
    .description("清理无效书签，并用 AI 重新整理浏览器导出的书签 HTML。")
    .version("0.1.0")
    .showHelpAfterError()
    .showSuggestionAfterError();

  program
    .command("check")
    .description("检查书签有效性，并直接在 CLI 输出结果。")
    .argument("<input>", "浏览器导出的 bookmarks.html")
    .option("--concurrency <number>", "并发检测数量", parsePositiveInteger, 20)
    .option("--timeout <ms>", "单个 URL 检测超时时间（毫秒）", parsePositiveInteger, 10000)
    .option("--retries <number>", "失败重试次数", parseNonNegativeInteger, 2)
    .action(async (inputPath: string, options: CheckOptions) => {
      await runCheckCommand(inputPath, options, dependencies);
    });

  program
    .command("clean")
    .description("检测书签并输出新的清理后 HTML 文件。")
    .argument("<input>", "浏览器导出的 bookmarks.html")
    .option("-o, --output <path>", "输出 HTML 文件路径")
    .option("--concurrency <number>", "并发检测数量", parsePositiveInteger, 20)
    .option("--timeout <ms>", "单个 URL 检测超时时间（毫秒）", parsePositiveInteger, 10000)
    .option("--retries <number>", "失败重试次数", parseNonNegativeInteger, 2)
    .action(async (inputPath: string, options: CleanOptions) => {
      await runCleanCommand(inputPath, options, dependencies);
    });

  program
    .command("classify")
    .description("调用 AI 智能分类书签，并输出新的 HTML 文件。")
    .argument("<input>", "浏览器导出的 bookmarks.html")
    .option("-o, --output <path>", "输出 HTML 文件路径")
    .option("--concurrency <number>", "并发检测数量", parsePositiveInteger, 20)
    .option("--timeout <ms>", "单个 URL 检测超时时间（毫秒）", parsePositiveInteger, 10000)
    .option("--retries <number>", "失败重试次数", parseNonNegativeInteger, 2)
    .option("--base-url <url>", "OpenAI 兼容 API 的 Base URL")
    .option("--model <name>", "AI 模型名称")
    .option("--api-key <key>", "AI API Key")
    .option("--lang <language>", "分类目录语言，默认 zh")
    .option("--langsmith", "启用 LangSmith 追踪")
    .option("--langsmith-api-key <key>", "LangSmith API Key")
    .option("--langsmith-project <name>", "LangSmith 项目名，默认 marksweep")
    .option("--langsmith-endpoint <url>", "LangSmith API endpoint")
    .option("--langsmith-workspace-id <id>", "LangSmith workspace ID")
    .option("--langsmith-hide-inputs", "发送 trace 时隐藏输入内容")
    .option("--langsmith-hide-outputs", "发送 trace 时隐藏输出内容")
    .action(async (inputPath: string, options: ClassifyOptions) => {
      await runClassifyCommand(inputPath, options, dependencies);
    });

  return program;
}

async function runCheckCommand(inputPath: string, options: CheckOptions, dependencies: CliDependencies): Promise<void> {
  const inputFile = await readBookmarkHtmlFile(inputPath);
  const parsed = parseBookmarkHtml(inputFile.html);
  const deduped = dedupeBookmarks(parsed.bookmarks);

  printParsedSummary(parsed, inputFile);
  printDeduplicationSummary(deduped);
  printDetectionOptions(options);

  const spinner = ora("正在检测书签有效性⋯⋯").start();
  const results = await dependencies.checkBookmarks(deduped.bookmarks, options);
  spinner.succeed("书签有效性检测完成");

  const summary = summarizeCheckResults(results);
  printCheckSummary(summary);
  printCheckResultList("明确无效", getBrokenResults(results));
  printCheckResultList("可疑（保留）", getSuspiciousResults(results));
}

async function runCleanCommand(inputPath: string, options: CleanOptions, dependencies: CliDependencies): Promise<void> {
  const inputFile = await readBookmarkHtmlFile(inputPath);
  const outputPath = resolveOutputPath(inputFile.absolutePath, options.output, "cleaned");
  await assertWritableOutputPath(inputFile.absolutePath, outputPath);

  const parsed = parseBookmarkHtml(inputFile.html);
  const deduped = dedupeBookmarks(parsed.bookmarks);
  printParsedSummary(parsed, inputFile);
  printDeduplicationSummary(deduped);
  printDetectionOptions(options);
  printOutputTarget(outputPath);

  const spinner = ora("正在检测并清理书签⋯⋯").start();
  const results = await dependencies.checkBookmarks(deduped.bookmarks, options);
  const keptBookmarks = getKeptResults(results).map((result) => result.bookmark);
  const suspiciousBookmarks = getSuspiciousResults(results).map((result) => result.bookmark);
  const suspiciousIds = new Set(suspiciousBookmarks.map((bookmark) => bookmark.id));
  const outputBookmarks = keptBookmarks.map((bookmark) =>
    suspiciousIds.has(bookmark.id) ? (moveBookmarksToFolder([bookmark], "其他")[0] ?? bookmark) : bookmark,
  );
  const html = renderBookmarkHtml(createBookmarkHtmlDocument(outputBookmarks));
  await writeFile(outputPath, html, "utf8");
  spinner.succeed("清理后的书签 HTML 已生成");

  const summary = summarizeCheckResults(results);
  printCheckSummary(summary);
  printCheckResultList("已删除的明确无效书签", getBrokenResults(results));
}

async function runClassifyCommand(
  inputPath: string,
  options: ClassifyOptions,
  dependencies: CliDependencies,
): Promise<void> {
  const inputFile = await readBookmarkHtmlFile(inputPath);
  const outputPath = resolveOutputPath(inputFile.absolutePath, options.output, "classified");
  await assertWritableOutputPath(inputFile.absolutePath, outputPath);

  const aiConfig = await resolveAiConfig(options);
  const langSmithConfig = resolveLangSmithConfig(options);
  const langSmithRuntime = createLangSmithRuntime(langSmithConfig, "classify");
  const parsed = parseBookmarkHtml(inputFile.html);
  const deduped = dedupeBookmarks(parsed.bookmarks);

  printParsedSummary(parsed, inputFile);
  printDeduplicationSummary(deduped);
  printDetectionOptions(options);
  printAiConfig(aiConfig);
  printLangSmithConfig(langSmithConfig);
  printOutputTarget(outputPath);

  try {
    const checkSpinner = ora("正在检测待分类书签⋯⋯").start();
    const results = await dependencies.checkBookmarks(deduped.bookmarks, options);
    checkSpinner.succeed("待分类书签检测完成");

    const summary = summarizeCheckResults(results);
    const validBookmarks = results.filter((result) => result.status === "valid").map((result) => result.bookmark);
    const otherBookmarks = results
      .filter((result) => result.status === "suspicious" || result.status === "skipped")
      .map((result) => result.bookmark);

    printCheckSummary(summary);
    printCheckResultList("分类前已跳过的明确无效书签", getBrokenResults(results));

    const spinner = ora(validBookmarks.length > 0 ? "正在调用 AI 分类书签⋯⋯" : "正在生成分类 HTML⋯⋯").start();
    let aiDocument = createBookmarkHtmlDocument([], { title: "Bookmarks" });

    if (validBookmarks.length > 0) {
      aiDocument = await dependencies.classifyBookmarks(validBookmarks, aiConfig, {
        lang: aiConfig.lang,
        fetcherOptions: resolveWebPageFetcherConfig(),
        callbacks: langSmithRuntime?.callbacks,
      });
    }

    const document = appendBookmarksToOtherFolder(aiDocument, otherBookmarks);
    const html = renderBookmarkHtml(document);
    await writeFile(outputPath, html, "utf8");
    spinner.succeed("分类后的书签 HTML 已生成");
  } finally {
    const traceError = await flushLangSmithRuntime(langSmithRuntime);
    if (traceError) {
      const message = traceError instanceof Error ? traceError.message : String(traceError);
      console.warn(chalk.yellow(`LangSmith trace 提交失败：${message}`));
    }
  }
}

function appendBookmarksToOtherFolder(
  document: BookmarkHtmlDocument,
  bookmarks: ExtractedBookmark[],
): BookmarkHtmlDocument {
  if (bookmarks.length === 0) {
    return document;
  }

  const otherBookmarks = moveBookmarksToFolder(bookmarks, "其他");
  let appended = false;
  const folders = document.folders.map((folder) => {
    if (folder.title !== "其他") {
      return folder;
    }

    appended = true;
    return {
      ...folder,
      bookmarks: [...folder.bookmarks, ...otherBookmarks],
    };
  });

  if (!appended) {
    folders.push({
      title: "其他",
      folders: [],
      bookmarks: otherBookmarks,
    });
  }

  return {
    ...document,
    folders,
  };
}

export type { BookmarkCheckResult, BookmarkHtmlDocument, CliDependencies, ExtractedBookmark };

function isDirectRun(): boolean {
  const currentFile = fileURLToPath(import.meta.url);
  const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return currentFile === entryFile;
}

if (isDirectRun()) {
  createProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`错误：${message}`));
      process.exitCode = 1;
    });
}
