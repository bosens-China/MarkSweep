import chalk from "chalk";
import type { Command } from "commander";
import { dedupeBookmarks } from "@marksweep/core/bookmarks/dedupe";
import { auditBookmarks, type AuditBookmarksOptions } from "@marksweep/core/classifier/bookmark-auditor";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";
import {
  createLangSmithRuntime,
  flushLangSmithRuntime,
  resolveLangSmithConfig,
  type RawLangSmithOptions,
} from "@marksweep/core/observability/langsmith";
import {
  parseAiCompatibility,
  parseNonNegativeInteger,
  readBookmarkHtmlFile,
  resolveAiConfig,
  resolveWebPageFetcherConfig,
  type RawAiOptions,
} from "@marksweep/core/config/config";

type AuditOptions = RawAiOptions & RawLangSmithOptions & { maxPages: number };

export interface AuditCommandDependencies {
  auditBookmarks?: typeof auditBookmarks;
}

export function registerAuditCommand(program: Command, dependencies: AuditCommandDependencies): void {
  program
    .command("audit")
    .description("由 AI 阅读必要页面，流式输出疑似过时书签清单和理由。")
    .argument("<input>", "浏览器导出的 bookmarks.html")
    .option("--base-url <url>", "OpenAI 兼容 API 的 Base URL")
    .option("--model <name>", "AI 模型名称")
    .option("--api-key <key>", "AI API Key")
    .option("--compatibility <mode>", "AI 兼容模式：auto、openai、deepseek", parseAiCompatibility)
    .option("--max-pages <number>", "最多允许 AI 阅读的页面数", parseNonNegativeInteger, 20)
    .option("--langsmith", "启用 LangSmith 追踪")
    .action(async (inputPath: string, options: AuditOptions) => {
      await runAuditCommand(inputPath, options, dependencies);
    });
}

async function runAuditCommand(
  inputPath: string,
  options: AuditOptions,
  dependencies: AuditCommandDependencies,
): Promise<void> {
  const inputFile = await readBookmarkHtmlFile(inputPath);
  const parsed = parseBookmarkHtml(inputFile.html);
  const deduped = dedupeBookmarks(parsed.bookmarks);
  if (deduped.bookmarks.length === 0) {
    console.error(chalk.gray("没有可审计的书签。"));
    process.stdout.write("# 疑似过时书签\n\n未发现有充分证据的过时内容。\n");
    return;
  }

  const aiConfig = await resolveAiConfig(options);
  const langSmithConfig = resolveLangSmithConfig(options);
  const langSmithRuntime = createLangSmithRuntime(langSmithConfig, "audit");
  const audit = dependencies.auditBookmarks ?? auditBookmarks;
  const auditOptions: AuditBookmarksOptions = {
    maxPages: options.maxPages,
    fetcherOptions: resolveWebPageFetcherConfig(),
    callbacks: langSmithRuntime?.callbacks,
    onProgress: (message) => console.error(chalk.gray(message)),
    onToken: (token) => process.stdout.write(token),
  };

  console.error(
    chalk.gray(`准备审计 ${deduped.bookmarks.length} 个去重后的书签，最多阅读 ${options.maxPages} 个页面。`),
  );
  try {
    await audit(deduped.bookmarks, aiConfig, auditOptions);
    process.stdout.write("\n");
  } finally {
    const traceError = await flushLangSmithRuntime(langSmithRuntime);
    if (traceError) {
      const message = traceError instanceof Error ? traceError.message : String(traceError);
      console.error(chalk.yellow(`LangSmith trace 提交失败：${message}`));
    }
  }
}
