import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram, type CliDependencies } from "../../src/cli";
import { parseBookmarkHtml } from "../../src/parser/bookmark-html";
import { renderBookmarkHtml, type BookmarkHtmlDocument } from "../../src/writer/bookmark-html";
import type { BookmarkCheckResult } from "../../src/checker/types";
import type { ClassifyBookmarksOptions } from "../../src/classifier/bookmark-classifier";
import type { AiConfig } from "../../src/cli/config";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("CLI classify integration", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const originalLangSmithApiKey = process.env.LANGSMITH_API_KEY;
  const originalLangSmithProject = process.env.LANGSMITH_PROJECT;
  const originalLangSmithTracing = process.env.LANGSMITH_TRACING;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    delete process.env.LANGSMITH_API_KEY;
    delete process.env.LANGSMITH_PROJECT;
    delete process.env.LANGSMITH_TRACING;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    restoreEnv("LANGSMITH_API_KEY", originalLangSmithApiKey);
    restoreEnv("LANGSMITH_PROJECT", originalLangSmithProject);
    restoreEnv("LANGSMITH_TRACING", originalLangSmithTracing);
  });

  it("writes AI-classified HTML without calling a real AI provider", async () => {
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

        return createAiDocument(bookmarks);
      },
    );
    const checkBookmarks = vi.fn(async (): Promise<BookmarkCheckResult[]> => {
      throw new Error("不应该在 classify 中检测书签");
    });
    const dependencies: CliDependencies = {
      checkBookmarks,
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
    expect(checkBookmarks).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("AI 分类回答：原始 3 个，去重后 3 个，输出 3 个，顶层分类 1 个"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("顶层目录：AI分类"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("遗漏：无"));
    expect(parsedOutput.folders.map((folder) => folder.title)).toContain("AI分类");
    expect(parsedOutput.bookmarks).toHaveLength(3);
  });

  it("prints missing bookmarks when the generated output omits URLs", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-classify-missing-"));
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

        return createAiDocument(bookmarks.filter((bookmark) => bookmark.title !== "Broken"));
      },
    );
    const dependencies: CliDependencies = {
      checkBookmarks: async () => {
        throw new Error("不应该在 classify 中检测书签");
      },
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

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("AI 分类回答：原始 3 个，去重后 3 个，输出 2 个，顶层分类 1 个"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("遗漏：1 个书签未进入输出文件"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Broken  https://broken.example.com"));
  });

  it("sends all deduped bookmarks directly to AI", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-classify-only-"));
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

        return createAiDocument(bookmarks);
      },
    );
    const checkBookmarks = vi.fn(async (): Promise<BookmarkCheckResult[]> => {
      throw new Error("不应该在 classify 中检测书签");
    });
    const dependencies: CliDependencies = {
      checkBookmarks,
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

    expect(checkBookmarks).not.toHaveBeenCalled();
    expect(classifiedBookmarks.map((bookmark) => bookmark.title)).toEqual(["Valid", "Broken", "Suspicious", "Chrome"]);
    expect(parsedOutput.bookmarks.map((bookmark) => bookmark.title)).toEqual([
      "Valid",
      "Broken",
      "Suspicious",
      "Chrome",
    ]);
    expect(parsedOutput.bookmarks.every((bookmark) => bookmark.folderPath[0] === "AI分类")).toBe(true);
  });

  it("can attach LangSmith callbacks to the AI classification run", async () => {
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

        return createAiDocument(bookmarks);
      },
    );
    const checkBookmarks = vi.fn(async (): Promise<BookmarkCheckResult[]> => {
      throw new Error("不应该在 classify 中检测书签");
    });
    process.env.LANGSMITH_API_KEY = "ls-test";
    process.env.LANGSMITH_PROJECT = "default";
    const dependencies: CliDependencies = {
      checkBookmarks,
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
    ]);

    expect(classifyBookmarks).toHaveBeenCalledOnce();
    expect(checkBookmarks).not.toHaveBeenCalled();
  });

  it("rethrows AI errors without writing output", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "marksweep-classify-fail-"));
    const inputPath = path.join(workspace, "bookmarks.html");
    const outputPath = path.join(workspace, "classified.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");

    const dependencies: CliDependencies = {
      checkBookmarks: async () => {
        throw new Error("不应该在 classify 中检测书签");
      },
      classifyBookmarks: async () => {
        throw new Error("AI boom");
      },
    };

    await expect(
      createProgram(dependencies).parseAsync([
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
      ]),
    ).rejects.toThrow("AI boom");
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
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

function createAiDocument(bookmarks: ExtractedBookmark[]): BookmarkHtmlDocument {
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
