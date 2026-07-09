import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram, type CliDependencies } from "../../src/cli";
import { createCheckReport, stringifyCheckReport } from "../../src/cli/check-report-file";
import { parseBookmarkHtml } from "../../src/parser/bookmark-html";
import { renderBookmarkHtml, type BookmarkHtmlDocument } from "../../src/writer/bookmark-html";
import type { BookmarkCheckResult } from "../../src/checker/types";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("CLI check report flow", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("check --json writes a reusable JSON report to stdout", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-check-json-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");

    const stdoutChunks: string[] = [];
    const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      return true;
    });
    const dependencies: CliDependencies = {
      checkBookmarks: async (bookmarks) => bookmarks.map((bookmark) => checkResult(bookmark, "valid", "ok", 200)),
      classifyBookmarks: async () => emptyDocument(),
    };

    try {
      await createProgram(dependencies).parseAsync(["node", "marksweep", "check", inputPath, "--json"]);
    } finally {
      stdoutWriteSpy.mockRestore();
    }

    const output = stdoutChunks.join("");
    const report = JSON.parse(output) as {
      version: number;
      inputPath: string;
      summary: { total: number; valid: number };
      results: BookmarkCheckResult[];
    };

    expect(report.version).toBe(1);
    expect(report.inputPath).toBe(inputPath);
    expect(report.summary).toMatchObject({ total: 3, valid: 3 });
    expect(report.results).toHaveLength(3);
    expect(output).not.toContain("检测结果");
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("clean --check-report reuses the report without checking bookmarks again", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-clean-report-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const reportPath = path.join(workspace, "report.json");
    const outputPath = path.join(workspace, "cleaned.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");
    await writeReport(inputPath, reportPath);

    const checkBookmarks = vi.fn(async (): Promise<BookmarkCheckResult[]> => {
      throw new Error("不应该重新检测书签");
    });
    const dependencies: CliDependencies = {
      checkBookmarks,
      classifyBookmarks: async () => emptyDocument(),
      selectResultsToDelete: async (candidates) =>
        candidates.filter((candidate) => candidate.bookmark.title === "Broken"),
    };

    await createProgram(dependencies).parseAsync([
      "node",
      "marksweep",
      "clean",
      inputPath,
      "--check-report",
      reportPath,
      "--output",
      outputPath,
    ]);

    const output = await readFile(outputPath, "utf8");
    const parsedOutput = parseBookmarkHtml(output);

    expect(checkBookmarks).not.toHaveBeenCalled();
    expect(parsedOutput.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Valid", "Suspicious"]);
    expect(parsedOutput.bookmarks.find((bookmark) => bookmark.title === "Suspicious")?.folderPath).toEqual(["其他"]);
    expect(output).not.toContain("Broken");
  });
});

async function writeReport(inputPath: string, reportPath: string): Promise<void> {
  const parsed = parseBookmarkHtml(await readFile(inputPath, "utf8"));
  const results = parsed.bookmarks.map((bookmark) => {
    if (bookmark.title === "Broken") {
      return checkResult(bookmark, "broken", "not_found", 404);
    }

    if (bookmark.title === "Suspicious") {
      return checkResult(bookmark, "suspicious", "timeout");
    }

    return checkResult(bookmark, "valid", "ok", 200);
  });

  await writeFile(reportPath, stringifyCheckReport(createCheckReport(inputPath, results)), "utf8");
}

function bookmarkFixture(): string {
  return renderBookmarkHtml({
    title: "Bookmarks",
    folders: [
      {
        title: "Root",
        folders: [],
        bookmarks: [
          bookmark("1", "Valid", "https://valid.example.com"),
          bookmark("2", "Broken", "https://broken.example.com"),
          bookmark("3", "Suspicious", "https://suspicious.example.com"),
        ],
      },
    ],
    bookmarks: [],
  });
}

function bookmark(id: string, title: string, url: string): ExtractedBookmark {
  return {
    id,
    title,
    url,
    folderPath: ["Root"],
    attributes: {
      href: url,
      add_date: id,
    },
    isWebUrl: true,
  };
}

function checkResult(
  bookmark: ExtractedBookmark,
  status: BookmarkCheckResult["status"],
  reason: BookmarkCheckResult["reason"],
  httpStatus?: number,
): BookmarkCheckResult {
  return {
    bookmark,
    status,
    reason,
    httpStatus,
    attempts: status === "skipped" ? 0 : 1,
  };
}

function emptyDocument(): BookmarkHtmlDocument {
  return {
    title: "Bookmarks",
    folders: [],
    bookmarks: [],
  };
}
