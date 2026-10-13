import { describe, expect, it } from "vitest";
import {
  createCheckReport,
  stringifyCheckReport,
  parseCheckReport,
  matchCheckReport,
} from "@marksweep/core/report/check-report-file";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";
import type { BookmarkCheckResult } from "@marksweep/core/checker/types";

const bookmark: ExtractedBookmark = {
  id: "old",
  title: "Old title",
  url: "https://example.com/guide/",
  folderPath: ["旧目录"],
  attributes: {},
  isWebUrl: true,
};
const result: BookmarkCheckResult = { bookmark, status: "broken", reason: "not_found", attempts: 1, httpStatus: 404 };

describe("reusable bookmark check reports", () => {
  it("reads CLI v1 reports and recomputes a trustworthy summary", () => {
    const report = createCheckReport("bookmarks.html", [result]);
    const decoded: unknown = JSON.parse(stringifyCheckReport(report));
    const parsed = parseCheckReport({ ...(decoded as object), summary: { valid: 999 } });
    expect(parsed.summary).toMatchObject({ total: 1, broken: 1, valid: 0 });
    expect(parsed.results).toEqual([result]);
  });
  it("matches by URL while preserving current IDs, titles, attributes and folders", () => {
    const current = {
      ...bookmark,
      id: "new",
      title: "Updated",
      url: "https://example.com/guide",
      folderPath: ["新目录"],
      attributes: { add_date: "123" },
    };
    const report = createCheckReport("old.html", [result]);
    expect(matchCheckReport([current], report)).toEqual([{ ...result, bookmark: current }]);
    expect(matchCheckReport([{ ...current, url: "https://unrelated.example" }], report)).toEqual([]);
  });
  it("matches HTTPS upgrades back to the original HTTP bookmark", () => {
    const upgraded = { ...result, status: "valid" as const, reason: "https_upgrade" as const, httpStatus: 200 };
    const current = { ...bookmark, id: "new", url: "http://example.com/guide", folderPath: ["Current"] };
    expect(matchCheckReport([current], createCheckReport("old.html", [upgraded]))[0]?.bookmark).toEqual({
      ...current,
      url: bookmark.url,
    });
  });
  it("rejects malformed report entries and conflicting verdicts", () => {
    expect(() => parseCheckReport({ version: 1, results: [null] })).toThrow("检测报告格式无效");
    expect(() =>
      parseCheckReport({ ...createCheckReport("old.html", [result]), results: [{ ...result, attempts: -1 }] }),
    ).toThrow("检测报告格式无效");
    expect(() =>
      matchCheckReport(
        [bookmark],
        createCheckReport("old.html", [result, { ...result, status: "valid", reason: "ok" }]),
      ),
    ).toThrow("冲突结果");
  });
});
