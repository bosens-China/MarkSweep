import { describe, expect, it, vi } from "vitest";
import { auditBookmarksWithAgent, createAuditSystemPrompt } from "@marksweep/core/classifier/bookmark-auditor";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";

describe("auditBookmarksWithAgent", () => {
  it("requires all three page-fetch conditions and names the skip cases", () => {
    const prompt = createAuditSystemPrompt();

    expect(prompt).toContain("必须同时满足三个条件");
    expect(prompt).toContain("具体内容页");
    expect(prompt).toContain("容易变化的知识");
    expect(prompt).toContain("仅凭标题、URL 和原目录不足以可靠判断");
    expect(prompt).toContain("Q&A、Issue、讨论帖");
    expect(prompt).toContain("不要抓取网站或产品首页、文档首页");
  });

  it("streams the final report token by token", async () => {
    const inputs: unknown[] = [];
    const agent = {
      stream: async (input: unknown) => {
        inputs.push(input);
        return (async function* () {
          yield [{ text: "# 疑似" }, {}] as const;
          yield [{ text: "过时书签" }, {}] as const;
        })();
      },
    };
    const onToken = vi.fn();

    const report = await auditBookmarksWithAgent([bookmark()], agent, { onToken });

    expect(report).toBe("# 疑似过时书签");
    expect(onToken.mock.calls.map(([token]) => token)).toEqual(["# 疑似", "过时书签"]);
    expect(JSON.stringify(inputs[0])).toContain("https://example.com/old-guide");
  });

  it("rejects an empty AI response", async () => {
    const agent = {
      stream: async () =>
        (async function* () {
          yield [{ text: "" }, {}] as const;
        })(),
    };

    await expect(auditBookmarksWithAgent([bookmark()], agent)).rejects.toThrow("AI 未返回过时内容审计清单");
  });
});

function bookmark(): ExtractedBookmark {
  return {
    id: "bookmark-1",
    title: "Old Guide",
    url: "https://example.com/old-guide",
    folderPath: ["技术"],
    attributes: {},
    isWebUrl: true,
  };
}
