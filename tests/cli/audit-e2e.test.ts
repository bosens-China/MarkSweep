import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram, type CliDependencies } from "../../src/cli";

describe("CLI audit integration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("streams an AI audit without checking or classifying bookmarks", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "marksweep-audit-"));
    const inputPath = path.join(directory, "bookmarks.html");
    await writeFile(inputPath, bookmarkFixture(), "utf8");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const auditBookmarks = vi.fn(async (_bookmarks, _config, options) => {
      options.onProgress?.("正在阅读");
      options.onToken?.("# 疑似过时书签");
      return "# 疑似过时书签";
    });
    const dependencies: CliDependencies = {
      checkBookmarks: vi.fn(async () => {
        throw new Error("audit 不应检测链接");
      }),
      classifyBookmarks: vi.fn(async () => {
        throw new Error("audit 不应分类书签");
      }),
      auditBookmarks,
    };

    await createProgram(dependencies).parseAsync([
      "node",
      "marksweep",
      "audit",
      inputPath,
      "--base-url",
      "https://api.example.com/v1",
      "--model",
      "demo-model",
      "--api-key",
      "sk-test",
      "--max-pages",
      "3",
    ]);

    expect(auditBookmarks).toHaveBeenCalledOnce();
    expect(auditBookmarks.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ maxPages: 3 }));
    expect(stdout.mock.calls.map(([text]) => text).join("")).toBe("# 疑似过时书签\n");
  });

  it("prints an empty report without requiring AI config", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "marksweep-audit-empty-"));
    const inputPath = path.join(directory, "bookmarks.html");
    await writeFile(inputPath, bookmarkFixture(false), "utf8");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const auditBookmarks = vi.fn();
    const dependencies: CliDependencies = {
      checkBookmarks: vi.fn(),
      classifyBookmarks: vi.fn(),
      auditBookmarks,
    };

    await createProgram(dependencies).parseAsync(["node", "marksweep", "audit", inputPath]);

    expect(auditBookmarks).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("# 疑似过时书签\n\n未发现有充分证据的过时内容。\n");
  });
});

function bookmarkFixture(withBookmark = true): string {
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>${withBookmark ? '<DT><A HREF="https://example.com/old-guide">Old Guide</A>' : ""}</DL><p>`;
}
