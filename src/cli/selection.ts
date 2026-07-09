import { checkbox } from "@inquirer/prompts";
import type { BookmarkCheckResult } from "../checker/types.js";

export interface SelectResultsToDeleteOptions {
  message?: string;
  checked?: boolean;
}

export type SelectResultsToDelete = (
  candidates: BookmarkCheckResult[],
  options?: SelectResultsToDeleteOptions,
) => Promise<BookmarkCheckResult[]>;

export async function selectResultsToDelete(
  candidates: BookmarkCheckResult[],
  options: SelectResultsToDeleteOptions = {},
): Promise<BookmarkCheckResult[]> {
  if (candidates.length === 0) {
    return [];
  }

  return checkbox({
    message: options.message ?? "选择要从输出文件中删除的书签（空格切换，回车确认）",
    pageSize: 12,
    loop: false,
    required: false,
    choices: candidates.map((result) => ({
      name: `${formatResultStatus(result)} ${result.bookmark.title}  ${result.bookmark.url}`,
      value: result,
      checked: options.checked ?? result.status === "broken",
      description: describeSelection(result),
    })),
  });
}

function formatResultStatus(result: BookmarkCheckResult): string {
  return result.httpStatus ? `HTTP ${result.httpStatus}` : result.reason;
}

function describeSelection(result: BookmarkCheckResult): string {
  if (result.status === "broken") {
    return "明确无效，默认会删除。";
  }

  if (result.status === "suspicious") {
    return "可疑链接，默认保留；确认不需要时再勾选删除。";
  }

  return "";
}
