import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration, printCheckResultList, printLangSmithConfig } from "../../src/cli/output";
import type { BookmarkCheckResult } from "../../src/checker/types";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("CLI output", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("prints every check result with title next to a bare URL", () => {
    const results = Array.from({ length: 25 }, (_, index) => result(`Title ${index}`, `https://example.com/${index}`));

    printCheckResultList("明确无效", results);

    const output = loggedLines(consoleLogSpy).join("\n");
    expect(output).toContain("Title 24  https://example.com/24");
    expect(output).not.toContain("(HTTP 404)");
    expect(output).not.toContain("还有");
  });

  it("groups check results by status and explains common meanings", () => {
    printCheckResultList("可疑（保留）", [
      result("Auth", "https://example.com/auth", "suspicious", "auth_required", 401),
      result("Auth 2", "https://example.com/auth-2", "suspicious", "auth_required", 401),
      result("Forbidden", "https://example.com/forbidden", "suspicious", "forbidden", 403),
    ]);

    const output = loggedLines(consoleLogSpy).join("\n");
    expect(output).toContain("HTTP 401：2 条");
    expect(output).toContain("需要认证或登录");
    expect(output).toContain("HTTP 403：1 条");
    expect(output).toContain("服务器拒绝访问");

    const lines = loggedLines(consoleLogSpy);
    const descriptionIndex = lines.findIndex((line) => line.includes("需要认证或登录"));
    expect(lines[descriptionIndex + 1]).toBe("");
  });

  it("prints the LangSmith project URL below the endpoint", () => {
    printLangSmithConfig(
      {
        enabled: true,
        apiKey: "ls-test",
        project: "default",
        endpoint: "https://api.smith.langchain.com",
      },
      "https://smith.langchain.com/o/workspace/projects/p/project",
    );

    const output = loggedLines(consoleLogSpy);
    const endpointIndex = output.findIndex((line) => line.includes("Endpoint："));
    expect(output[endpointIndex + 1]).toContain("URL：https://smith.langchain.com/");
  });
});

function loggedLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return (spy.mock.calls as unknown[][]).map((call) => String(call[0]));
}

describe("formatDuration", () => {
  it("uses minutes and seconds for durations of at least one minute", () => {
    expect(formatDuration(999)).toBe("999 ms");
    expect(formatDuration(59900)).toBe("59.9 秒");
    expect(formatDuration(60000)).toBe("1 分钟 0 秒");
    expect(formatDuration(125500)).toBe("2 分钟 6 秒");
  });
});

function result(
  title: string,
  url: string,
  status: BookmarkCheckResult["status"] = "broken",
  reason: BookmarkCheckResult["reason"] = "not_found",
  httpStatus = 404,
): BookmarkCheckResult {
  return {
    bookmark: bookmark(title, url),
    status,
    reason,
    httpStatus,
    attempts: 1,
  };
}

function bookmark(title: string, url: string): ExtractedBookmark {
  return {
    id: url,
    title,
    url,
    folderPath: [],
    attributes: {},
    isWebUrl: true,
  };
}
