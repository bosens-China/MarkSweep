import { readFile } from "node:fs/promises";
import { summarizeCheckResults } from "../checker/bookmark-checker.js";
import type { BookmarkCheckResult, BookmarkCheckSummary } from "../checker/types.js";

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

export async function readCheckReportFile(reportPath: string): Promise<BookmarkCheckResult[]> {
  const parsed = JSON.parse(await readFile(reportPath, "utf8")) as unknown;

  if (!isCheckReportFile(parsed)) {
    throw new Error("检测报告格式无效，请使用 marksweep check --json 生成。");
  }

  return parsed.results;
}

function isCheckReportFile(value: unknown): value is CheckReportFile {
  return isRecord(value) && value.version === 1 && Array.isArray(value.results);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
