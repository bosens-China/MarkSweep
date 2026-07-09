import chalk from "chalk";
import ora from "ora";
import type { BookmarkCheckResult } from "../checker/types.js";
import type { CheckBookmarksProgress } from "../checker/bookmark-checker.js";

export function createCheckProgressReporter(spinner: ReturnType<typeof ora>, label: string) {
  return (progress: CheckBookmarksProgress): void => {
    spinner.text = `${label} ${formatProgressBar(progress.completed, progress.total)} ${progress.completed}/${
      progress.total
    } ${progress.bookmark.title} ${progress.bookmark.url} ${formatProgressStatus(progress.result.status)}`;
  };
}

function formatProgressBar(completed: number, total: number): string {
  const width = 20;
  const filled = total > 0 ? Math.round((completed / total) * width) : width;

  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function formatProgressStatus(status: BookmarkCheckResult["status"]): string {
  switch (status) {
    case "valid":
      return chalk.green("有效");
    case "broken":
      return chalk.red("无效");
    case "suspicious":
      return chalk.yellow("可疑");
    case "skipped":
      return chalk.gray("跳过");
  }
}
