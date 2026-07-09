import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram, type CliDependencies } from "../../src/cli";
import { parseBookmarkHtml } from "../../src/parser/bookmark-html";
import { renderBookmarkHtml, type BookmarkHtmlDocument } from "../../src/writer/bookmark-html";
import type { BookmarkCheckResult } from "../../src/checker/types";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";
import type { AiConfig } from "../../src/cli/config";
import type { ClassifyBookmarksOptions } from "../../src/classifier/bookmark-classifier";

describe("CLI integration", () => {
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

  it("clean writes a new HTML file, removes broken bookmarks, and moves suspicious bookmarks to 其他", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-clean-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const outputPath = path.join(workspace, "cleaned.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");

    const selectResultsToDelete = vi.fn(async (candidates: BookmarkCheckResult[]) =>
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

  it("classify writes AI-classified HTML without calling a real AI provider", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-classify-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const outputPath = path.join(workspace, "classified.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");

    const classifyBookmarks = vi.fn(
      async (
        bookmarks: ExtractedBookmark[],
        aiConfig: AiConfig,
        options?: ClassifyBookmarksOptions,
      ): Promise<BookmarkHtmlDocument> => {
        void aiConfig;
        void options;

        return {
          title: "Bookmarks",
          folders: [
            {
              title: "AI分类",
              folders: [],
              bookmarks: bookmarks.map((bookmark) => ({
                ...bookmark,
                folderPath: ["AI分类"],
              })),
            },
          ],
          bookmarks: [],
        };
      },
    );
    const dependencies: CliDependencies = {
      checkBookmarks: async (bookmarks) => bookmarks.map((bookmark) => checkResult(bookmark, "valid", "ok", 200)),
      classifyBookmarks,
    };

    await createProgram(dependencies).parseAsync([
      "node",
      "marksweep",
      "classify",
      inputPath,
      "--output",
      outputPath,
      "--base-url",
      "https://api.example.com/v1",
      "--model",
      "demo-model",
      "--api-key",
      "sk-test",
    ]);

    const output = await readFile(outputPath, "utf8");
    const parsedOutput = parseBookmarkHtml(output);

    expect(classifyBookmarks).toHaveBeenCalledOnce();
    expect(parsedOutput.folders.map((folder) => folder.title)).toContain("AI分类");
    expect(parsedOutput.bookmarks).toHaveLength(3);
  });

  it("classify checks bookmarks first and pins suspicious and non-web bookmarks to 其他", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-classify-check-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const outputPath = path.join(workspace, "classified.html");
    await writeFile(inputPath, mixedClassificationFixture(), "utf8");

    const classifyBookmarks = vi.fn(
      async (
        bookmarks: ExtractedBookmark[],
        aiConfig: AiConfig,
        options?: ClassifyBookmarksOptions,
      ): Promise<BookmarkHtmlDocument> => {
        void aiConfig;
        void options;

        return {
          title: "Bookmarks",
          folders: [
            {
              title: "AI分类",
              folders: [],
              bookmarks: bookmarks.map((bookmark) => ({
                ...bookmark,
                folderPath: ["AI分类"],
              })),
            },
          ],
          bookmarks: [],
        };
      },
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

          if (bookmark.title === "Chrome") {
            return checkResult(bookmark, "skipped", "non_web_url");
          }

          return checkResult(bookmark, "valid", "ok", 200);
        }),
      classifyBookmarks,
    };

    await createProgram(dependencies).parseAsync([
      "node",
      "marksweep",
      "classify",
      inputPath,
      "--output",
      outputPath,
      "--base-url",
      "https://api.example.com/v1",
      "--model",
      "demo-model",
      "--api-key",
      "sk-test",
    ]);

    const output = await readFile(outputPath, "utf8");
    const parsedOutput = parseBookmarkHtml(output);
    const classifiedBookmarks = classifyBookmarks.mock.calls[0]?.[0] ?? [];

    expect(classifiedBookmarks.map((bookmark) => bookmark.title)).toEqual(["Valid"]);
    expect(parsedOutput.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Valid", "Suspicious", "Chrome"]);
    expect(parsedOutput.bookmarks.find((bookmark) => bookmark.title === "Broken")).toBeUndefined();
    expect(parsedOutput.bookmarks.find((bookmark) => bookmark.title === "Suspicious")?.folderPath).toEqual(["其他"]);
    expect(parsedOutput.bookmarks.find((bookmark) => bookmark.title === "Chrome")?.folderPath).toEqual(["其他"]);
  });

  it("classify can attach LangSmith callbacks to the AI classification run", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-langsmith-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const outputPath = path.join(workspace, "classified.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");

    const classifyBookmarks = vi.fn(
      async (
        bookmarks: ExtractedBookmark[],
        aiConfig: AiConfig,
        options?: ClassifyBookmarksOptions,
      ): Promise<BookmarkHtmlDocument> => {
        void aiConfig;
        expect(options?.callbacks).toHaveLength(1);

        return {
          title: "Bookmarks",
          folders: [
            {
              title: "AI分类",
              folders: [],
              bookmarks: bookmarks.map((bookmark) => ({
                ...bookmark,
                folderPath: ["AI分类"],
              })),
            },
          ],
          bookmarks: [],
        };
      },
    );
    const dependencies: CliDependencies = {
      checkBookmarks: async (bookmarks) => bookmarks.map((bookmark) => checkResult(bookmark, "valid", "ok", 200)),
      classifyBookmarks,
    };

    await createProgram(dependencies).parseAsync([
      "node",
      "marksweep",
      "classify",
      inputPath,
      "--output",
      outputPath,
      "--base-url",
      "https://api.example.com/v1",
      "--model",
      "demo-model",
      "--api-key",
      "sk-test",
      "--langsmith",
      "--langsmith-api-key",
      "ls-test",
      "--langsmith-hide-inputs",
    ]);

    expect(classifyBookmarks).toHaveBeenCalledOnce();
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

function mixedClassificationFixture(): string {
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
          bookmark("4", "Chrome", "chrome://settings"),
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
