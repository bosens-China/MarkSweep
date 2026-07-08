import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import { normalizeBookmarkUrl } from "./url.js";

const weakTitlePatterns = [
  /^$/,
  /^首页$/i,
  /^home$/i,
  /^untitled$/i,
  /^document$/i,
  /^new tab$/i,
  /^github$/i,
  /^index$/i,
];

export interface DuplicateBookmarkGroup {
  normalizedUrl: string;
  kept: ExtractedBookmark;
  removed: ExtractedBookmark[];
}

export interface DeduplicationResult {
  bookmarks: ExtractedBookmark[];
  duplicates: DuplicateBookmarkGroup[];
}

export function dedupeBookmarks(bookmarks: ExtractedBookmark[]): DeduplicationResult {
  const groups = new Map<string, ExtractedBookmark[]>();

  for (const bookmark of bookmarks) {
    const normalizedUrl = normalizeBookmarkUrl(bookmark.url);
    const group = groups.get(normalizedUrl);

    if (group) {
      group.push(bookmark);
    } else {
      groups.set(normalizedUrl, [bookmark]);
    }
  }

  const deduped: ExtractedBookmark[] = [];
  const duplicates: DuplicateBookmarkGroup[] = [];

  for (const [normalizedUrl, group] of groups) {
    const ranked = [...group].sort(compareBookmarksForRetention);
    const kept = ranked[0];

    if (!kept) {
      continue;
    }

    deduped.push(kept);

    if (ranked.length > 1) {
      duplicates.push({
        normalizedUrl,
        kept,
        removed: ranked.slice(1),
      });
    }
  }

  return {
    bookmarks: deduped,
    duplicates,
  };
}

export function compareBookmarksForRetention(first: ExtractedBookmark, second: ExtractedBookmark): number {
  const firstScore = scoreTitle(first.title);
  const secondScore = scoreTitle(second.title);

  if (firstScore !== secondScore) {
    return secondScore - firstScore;
  }

  const firstAttributeCount = Object.keys(first.attributes).length;
  const secondAttributeCount = Object.keys(second.attributes).length;

  if (firstAttributeCount !== secondAttributeCount) {
    return secondAttributeCount - firstAttributeCount;
  }

  return 0;
}

export function scoreTitle(title: string): number {
  const normalized = title.trim();
  const weakPenalty = weakTitlePatterns.some((pattern) => pattern.test(normalized)) ? 100 : 0;
  const readableChars = [...normalized].filter((char) => /\p{L}|\p{N}/u.test(char)).length;

  return readableChars - weakPenalty;
}

export function createDeduplicationReport(result: DeduplicationResult): {
  keptCount: number;
  duplicateGroupCount: number;
  removedCount: number;
} {
  return {
    keptCount: result.bookmarks.length,
    duplicateGroupCount: result.duplicates.length,
    removedCount: result.duplicates.reduce((sum, group) => sum + group.removed.length, 0),
  };
}
