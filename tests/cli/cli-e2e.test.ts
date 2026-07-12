import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram, type CliDependencies } from "../../src/cli";
import { parseBookmarkHtml } from "../../src/parser/bookmark-html";
import { renderBookmarkHtml, type BookmarkHtmlDocument } from "../../src/writer/bookmark-html";
import type { BookmarkCheckResult } from "../../src/checker/types";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";
import type { SelectResultsToDelete } from "../../src/cli/selection";

describe("CLI integration", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("clean writes a new HTML file, removes broken bookmarks, and moves suspicious bookmarks to 其他", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-clean-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const outputPath = path.join(workspace, "cleaned.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");

    const selectResultsToDelete = vi.fn<SelectResultsToDelete>(async (candidates) =>
      candidates.filter((candidate) => candidate.bookmark.title === "Broken"),
    );
    const dependencies: CliDependencies = {
      checkBookmarks: async (bookmarks) =>
        bookmarks.map((bookmark) => {
          if (bookmark.title === "Broken") {
            return checkResult(bookmark, "broken", "not_found", 404);
          }

          if (bookmark.title === "Suspicious") {
            return checkResult(bookmark, "suspicious", "timeout");
          }

          return checkResult(bookmark, "valid", "ok", 200);
        }),
      classifyBookmarks: async () => emptyDocument(),
      selectResultsToDelete,
    };

    await createProgram(dependencies).parseAsync(["node", "marksweep", "clean", inputPath, "--output", outputPath]);

    const original = await readFile(inputPath, "utf8");
    const output = await readFile(outputPath, "utf8");
    const parsedOutput = parseBookmarkHtml(output);

    expect(original).toContain("Broken");
    expect(parsedOutput.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Valid", "Suspicious"]);
    expect(parsedOutput.bookmarks.find((bookmark) => bookmark.title === "Suspicious")?.folderPath).toEqual(["其他"]);
    expect(output).not.toContain("Broken");
    expect(selectResultsToDelete).toHaveBeenCalledTimes(2);
    expect(selectResultsToDelete.mock.calls[0]?.[0].map((candidate) => candidate.bookmark.title)).toEqual(["Broken"]);
    expect(selectResultsToDelete.mock.calls[0]?.[1]).toMatchObject({ checked: true });
    expect(selectResultsToDelete.mock.calls[1]?.[0].map((candidate) => candidate.bookmark.title)).toEqual([
      "Suspicious",
    ]);
    expect(selectResultsToDelete.mock.calls[1]?.[1]).toMatchObject({ checked: false });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("剩余 2 个书签，删除 1 个书签"));
  });

  it("clean keeps unchecked broken bookmarks and deletes selected suspicious bookmarks", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-clean-select-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const outputPath = path.join(workspace, "cleaned.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");

    const dependencies: CliDependencies = {
      checkBookmarks: async (bookmarks) =>
        bookmarks.map((bookmark) => {
          if (bookmark.title === "Broken") {
            return checkResult(bookmark, "broken", "not_found", 404);
          }

          if (bookmark.title === "Suspicious") {
            return checkResult(bookmark, "suspicious", "timeout");
          }

          return checkResult(bookmark, "valid", "ok", 200);
        }),
      classifyBookmarks: async () => emptyDocument(),
      selectResultsToDelete: async (candidates) =>
        candidates.filter((candidate) => candidate.bookmark.title === "Suspicious"),
    };

    await createProgram(dependencies).parseAsync(["node", "marksweep", "clean", inputPath, "--output", outputPath]);

    const output = await readFile(outputPath, "utf8");
    const parsedOutput = parseBookmarkHtml(output);

    expect(parsedOutput.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Valid", "Broken"]);
    expect(parsedOutput.bookmarks.find((bookmark) => bookmark.title === "Broken")?.folderPath).toEqual(["Root"]);
    expect(output).not.toContain("Suspicious");
  });
});

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
    isWebUrl: url.startsWith("http"),
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
