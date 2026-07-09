#!/usr/bin/env node
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { config as loadDotEnv } from "dotenv";
import ora from "ora";
import { dedupeBookmarks } from "./bookmarks/dedupe.js";
import { normalizeBookmarkUrl } from "./bookmarks/url.js";
import { checkBookmarks, summarizeCheckResults } from "./checker/bookmark-checker.js";
import { classifyBookmarks } from "./classifier/bookmark-classifier.js";
import { createCheckReport, readCheckReportFile, stringifyCheckReport } from "./cli/check-report-file.js";
import {
  createLangSmithRuntime,
  flushLangSmithRuntime,
  resolveLangSmithConfig,
  type RawLangSmithOptions,
} from "./observability/langsmith.js";
import { getBrokenResults, getSuspiciousResults } from "./report/check-report.js";
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
  printCheckResultGroupDescriptions,
  printCheckResultList,
  printCheckSummary,
  printDeduplicationSummary,
  printDetectionOptions,
  printLangSmithConfig,
  printOutputTarget,
  printParsedSummary,
} from "./cli/output.js";
import { createCheckProgressReporter } from "./cli/progress.js";
import { installAutoProxy } from "./cli/proxy.js";
import { selectResultsToDelete, type SelectResultsToDelete } from "./cli/selection.js";
import { createBookmarkHtmlDocument, moveBookmarksToFolder, renderBookmarkHtml } from "./writer/bookmark-html.js";
import type { BookmarkCheckResult } from "./checker/types.js";
import type { ExtractedBookmark } from "./parser/bookmark-html.js";
import type { BookmarkHtmlDocument } from "./writer/bookmark-html.js";

loadDotEnv({ quiet: true });

interface OutputOption {
  output?: string;
}

interface JsonOption {
  json?: boolean;
}

interface CheckReportOption {
  checkReport?: string;
}

type CheckOptions = DetectionOptions & JsonOption;
type CleanOptions = DetectionOptions & OutputOption & CheckReportOption;
type ClassifyOptions = RawAiOptions & RawLangSmithOptions & OutputOption;

interface CliDependencies {
  checkBookmarks: typeof checkBookmarks;
  classifyBookmarks: typeof classifyBookmarks;
  selectResultsToDelete?: SelectResultsToDelete;
}

const defaultDependencies: CliDependencies = {
  checkBookmarks,
  classifyBookmarks,
  selectResultsToDelete,
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
    .option("--json", "输出 JSON 检测报告，便于 clean 复用")
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
    .option("--check-report <path>", "复用 marksweep check --json 生成的检测报告")
    .action(async (inputPath: string, options: CleanOptions) => {
      await runCleanCommand(inputPath, options, dependencies);
    });

  program
    .command("classify")
    .description("调用 AI 智能分类书签，并输出新的 HTML 文件。")
    .argument("<input>", "浏览器导出的 bookmarks.html")
    .option("-o, --output <path>", "输出 HTML 文件路径")
    .option("--base-url <url>", "OpenAI 兼容 API 的 Base URL")
    .option("--model <name>", "AI 模型名称")
    .option("--api-key <key>", "AI API Key")
    .option("--lang <language>", "分类目录语言，默认 zh")
    .option("--langsmith", "启用 LangSmith 追踪")
    .action(async (inputPath: string, options: ClassifyOptions) => {
      await runClassifyCommand(inputPath, options, dependencies);
    });

  return program;
}

async function runCheckCommand(inputPath: string, options: CheckOptions, dependencies: CliDependencies): Promise<void> {
  const inputFile = await readBookmarkHtmlFile(inputPath);
  const parsed = parseBookmarkHtml(inputFile.html);
  const deduped = dedupeBookmarks(parsed.bookmarks);

  if (options.json) {
    const results = await dependencies.checkBookmarks(deduped.bookmarks, options);
    process.stdout.write(stringifyCheckReport(createCheckReport(inputFile.absolutePath, results)));
    return;
  }

  printParsedSummary(parsed, inputFile);
  printDeduplicationSummary(deduped);
  printDetectionOptions(options);

  const spinner = ora("正在检测书签有效性⋯⋯").start();
  let results: BookmarkCheckResult[];
  try {
    results = await dependencies.checkBookmarks(deduped.bookmarks, options, {
      onProgress: createCheckProgressReporter(spinner, "正在检测书签有效性"),
    });
    spinner.succeed("书签有效性检测完成");
  } catch (error) {
    spinner.fail("书签有效性检测失败");
    throw error;
  }

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
  if (!options.checkReport) {
    printDetectionOptions(options);
  }
  printOutputTarget(outputPath);

  let results: BookmarkCheckResult[];
  if (options.checkReport) {
    results = await readCheckReportFile(options.checkReport);
  } else {
    const spinner = ora("正在检测并清理书签⋯⋯").start();
    try {
      results = await dependencies.checkBookmarks(deduped.bookmarks, options, {
        onProgress: createCheckProgressReporter(spinner, "正在检测并清理书签"),
      });
      spinner.succeed("书签检测完成");
    } catch (error) {
      spinner.fail("书签检测失败");
      throw error;
    }
  }

  const brokenResults = getBrokenResults(results);
  const suspiciousResults = getSuspiciousResults(results);
  const selectToDelete = dependencies.selectResultsToDelete ?? selectResultsToDelete;
  const brokenToDelete = await selectCleanDeletionStage(
    "第 1 步：选择要删除的明确无效书签（默认全选）",
    brokenResults,
    true,
    selectToDelete,
  );
  const suspiciousToDelete = await selectCleanDeletionStage(
    "第 2 步：选择要删除的可疑书签（默认不选）",
    suspiciousResults,
    false,
    selectToDelete,
  );
  const resultsToDelete = [...brokenToDelete, ...suspiciousToDelete];
  const deletedIds = new Set(resultsToDelete.map((result) => result.bookmark.id));
  const keptResults = results.filter((result) => !deletedIds.has(result.bookmark.id));
  const keptBookmarks = keptResults.map((result) => result.bookmark);
  const suspiciousIds = new Set(
    keptResults.filter((result) => result.status === "suspicious").map((result) => result.bookmark.id),
  );
  const outputBookmarks = keptBookmarks.map((bookmark) =>
    suspiciousIds.has(bookmark.id) ? (moveBookmarksToFolder([bookmark], "其他")[0] ?? bookmark) : bookmark,
  );
  const html = renderBookmarkHtml(createBookmarkHtmlDocument(outputBookmarks));
  await writeFile(outputPath, html, "utf8");
  console.log(
    chalk.green(
      `清理后的书签 HTML 已生成：剩余 ${outputBookmarks.length} 个书签，删除 ${resultsToDelete.length} 个书签`,
    ),
  );
  printCheckResultList("已删除的书签", resultsToDelete);
}

async function selectCleanDeletionStage(
  title: string,
  results: BookmarkCheckResult[],
  checked: boolean,
  selectToDelete: SelectResultsToDelete,
): Promise<BookmarkCheckResult[]> {
  if (results.length === 0) {
    return [];
  }

  printCheckResultGroupDescriptions(title, results);
  return selectToDelete(results, {
    message: "选择要从输出文件中删除的书签（空格切换，回车确认）",
    checked,
  });
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
  printAiConfig(aiConfig);
  printLangSmithConfig(langSmithConfig);
  printOutputTarget(outputPath);

  const spinner = ora(deduped.bookmarks.length > 0 ? "正在调用 AI 分类书签⋯⋯" : "正在生成分类 HTML⋯⋯").start();
  try {
    let aiDocument = createBookmarkHtmlDocument([], { title: "Bookmarks" });

    if (deduped.bookmarks.length > 0) {
      aiDocument = await dependencies.classifyBookmarks(deduped.bookmarks, aiConfig, {
        lang: aiConfig.lang,
        fetcherOptions: resolveWebPageFetcherConfig(),
        callbacks: langSmithRuntime?.callbacks,
      });
    }

    const html = renderBookmarkHtml(aiDocument);
    const classificationAnswer = createClassificationAnswer(parsed.bookmarks.length, deduped.bookmarks, html);
    await writeFile(outputPath, html, "utf8");
    spinner.succeed("分类后的书签 HTML 已生成");
    printClassificationAnswer(classificationAnswer);
  } catch (error) {
    spinner.fail("AI 分类失败");
    throw error;
  } finally {
    const traceError = await flushLangSmithRuntime(langSmithRuntime);
    if (traceError) {
      const message = traceError instanceof Error ? traceError.message : String(traceError);
      console.warn(chalk.yellow(`LangSmith trace 提交失败：${message}`));
    }
  }
}

interface ClassificationAnswer {
  originalCount: number;
  dedupedCount: number;
  outputCount: number;
  topFolders: string[];
  missingBookmarks: ExtractedBookmark[];
}

function createClassificationAnswer(
  originalCount: number,
  dedupedBookmarks: ExtractedBookmark[],
  outputHtml: string,
): ClassificationAnswer {
  const outputParsed = parseBookmarkHtml(outputHtml);
  const outputUrls = new Set(outputParsed.bookmarks.map((bookmark) => normalizeBookmarkUrl(bookmark.url)));
  const missingBookmarks = dedupedBookmarks.filter((bookmark) => !outputUrls.has(normalizeBookmarkUrl(bookmark.url)));

  return {
    originalCount,
    dedupedCount: dedupedBookmarks.length,
    outputCount: outputParsed.bookmarks.length,
    topFolders: outputParsed.folders.filter((folder) => folder.path.length === 1).map((folder) => folder.title),
    missingBookmarks,
  };
}

function printClassificationAnswer(answer: ClassificationAnswer): void {
  console.log(
    chalk.green(
      `AI 分类回答：原始 ${answer.originalCount} 个，去重后 ${answer.dedupedCount} 个，输出 ${answer.outputCount} 个，顶层分类 ${answer.topFolders.length} 个。`,
    ),
  );
  if (answer.topFolders.length > 0) {
    console.log(chalk.gray(`顶层目录：${answer.topFolders.join("、")}`));
  }

  if (answer.missingBookmarks.length === 0) {
    console.log(chalk.gray("遗漏：无"));
    return;
  }

  console.log(chalk.yellow(`遗漏：${answer.missingBookmarks.length} 个书签未进入输出文件`));
  for (const bookmark of answer.missingBookmarks) {
    console.log(chalk.yellow(`  - ${bookmark.title}  ${bookmark.url}`));
  }
}

export type { BookmarkCheckResult, BookmarkHtmlDocument, CliDependencies, ExtractedBookmark };

function isDirectRun(): boolean {
  const currentFile = fileURLToPath(import.meta.url);
  const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return currentFile === entryFile;
}

if (isDirectRun()) {
  installAutoProxy();

  createProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`错误：${message}`));
      process.exitCode = 1;
    });
}
