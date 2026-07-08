import { describe, expect, it } from "vitest";
import { getBrokenResults, getKeptResults, getSuspiciousResults } from "../../src/report/check-report";
import type { BookmarkCheckResult } from "../../src/checker/types";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("check report helpers", () => {
  it("splits broken, suspicious, and kept results", () => {
    const results = [
      result("valid", "ok"),
      result("broken", "not_found"),
      result("suspicious", "timeout"),
      result("skipped", "non_web_url"),
    ];

    expect(getBrokenResults(results).map((item) => item.status)).toEqual(["broken"]);
    expect(getSuspiciousResults(results).map((item) => item.status)).toEqual(["suspicious"]);
    expect(getKeptResults(results).map((item) => item.status)).toEqual(["valid", "suspicious", "skipped"]);
  });
});

function result(status: BookmarkCheckResult["status"], reason: BookmarkCheckResult["reason"]): BookmarkCheckResult {
  return {
    bookmark: bookmark(status),
    status,
    reason,
    attempts: status === "skipped" ? 0 : 1,
  };
}

function bookmark(id: string): ExtractedBookmark {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    folderPath: [],
    attributes: {},
    isWebUrl: true,
  };
}
