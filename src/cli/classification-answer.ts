import chalk from "chalk";
import { normalizeBookmarkUrl } from "@marksweep/core/bookmarks/url";
import { parseBookmarkHtml, type ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";

interface ClassificationAnswer {
  originalCount: number;
  dedupedCount: number;
  outputCount: number;
  topFolders: string[];
  missingBookmarks: ExtractedBookmark[];
}

export function createClassificationAnswer(
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

export function printClassificationAnswer(answer: ClassificationAnswer): void {
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
