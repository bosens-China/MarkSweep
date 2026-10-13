import type { BookmarkCheckResult } from "../checker/types.js";

export function getBrokenResults(results: BookmarkCheckResult[]): BookmarkCheckResult[] {
  return results.filter((result) => result.status === "broken");
}

export function getSuspiciousResults(results: BookmarkCheckResult[]): BookmarkCheckResult[] {
  return results.filter((result) => result.status === "suspicious");
}

export function getKeptResults(results: BookmarkCheckResult[]): BookmarkCheckResult[] {
  return results.filter(
    (result) => result.status === "valid" || result.status === "suspicious" || result.status === "skipped",
  );
}
