import { describe, expect, it, vi } from "vitest";
import {
  classificationToHtmlDocument,
  classifyBookmarksWithAgent,
  resolveCompatibility,
  validateClassification,
} from "../../src/classifier/bookmark-classifier";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("classification validation", () => {
  it("throws when the AI response misses a bookmark", () => {
    expect(() =>
      validateClassification([bookmark("a"), bookmark("b")], {
        folders: [{ title: "Dev", bookmarks: [1], children: [] }],
      }),
    ).toThrow("缺失序号：2");
  });

  it("throws on duplicate bookmark IDs", () => {
    expect(() =>
      validateClassification([bookmark("a")], {
        folders: [{ title: "Dev", bookmarks: [1, 1], children: [] }],
      }),
    ).toThrow("重复序号：1");
  });

  it("converts classification folders to a renderable document", () => {
    const document = classificationToHtmlDocument([bookmark("a"), bookmark("b")], {
      folders: [
        {
          title: "开发",
          bookmarks: [1],
          children: [{ title: "文档", bookmarks: [2], children: [] }],
        },
      ],
    });

    expect(document.folders[0]?.title).toBe("开发");
    expect(document.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["a"]);
    expect(document.folders[0]?.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["b"]);
  });

  it("matches classified bookmarks by short numeric IDs", () => {
    const document = classificationToHtmlDocument([bookmark("a", "Title", "https://example.com/a/")], {
      folders: [{ title: "开发", bookmarks: [1], children: [] }],
    });

    expect(document.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("classifyBookmarksWithAgent", () => {
  it("sends every bookmark to the agent and consumes its structured response", async () => {
    const invoke = vi.fn(async (input: { messages: Array<{ role: "user"; content: string }> }) => {
      expect(input.messages).toHaveLength(1);
      return { structuredResponse: { folders: [{ title: "开发", bookmarks: [1, 2], children: [] }] } };
    });
    const onProgress = vi.fn();
    const first = bookmark("a", "TypeScript Documentation");
    first.folderPath = ["旧目录"];
    const document = await classifyBookmarksWithAgent([first, bookmark("b", "首页")], { invoke }, onProgress);

    const prompt = invoke.mock.calls[0]?.[0].messages[0]?.content;
    expect(prompt).toContain("TypeScript Documentation");
    expect(prompt).toContain("首页");
    expect(prompt).toContain("旧目录");
    expect(onProgress).toHaveBeenCalledWith("正在由 AI 判断是否需要抓取网页并生成分类目录⋯⋯");
    expect(onProgress).toHaveBeenLastCalledWith("正在校验分类结果⋯⋯");
    expect(document.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("rejects a missing structured response", async () => {
    await expect(classifyBookmarksWithAgent([bookmark("a")], { invoke: async () => ({}) })).rejects.toThrow();
  });

  it("passes callbacks at the agent invocation level", async () => {
    const invoke = vi.fn(async () => ({
      structuredResponse: { folders: [{ title: "开发", bookmarks: [1], children: [] }] },
    }));
    const callbacks = [vi.fn()] as never;

    await classifyBookmarksWithAgent([bookmark("a")], { invoke }, undefined, undefined, callbacks);

    expect(invoke).toHaveBeenCalledWith(expect.any(Object), { callbacks });
  });
});

describe("resolveCompatibility", () => {
  const config = {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "test-key",
    lang: "zh",
    compatibility: "auto" as const,
  };

  it("auto-detects only the official DeepSeek endpoint", () => {
    expect(resolveCompatibility(config)).toBe("deepseek");
    expect(resolveCompatibility({ ...config, baseUrl: "https://api.deepseek.com/v1" })).toBe("deepseek");
    expect(resolveCompatibility({ ...config, baseUrl: "https://gateway.example.com/v1" })).toBe("openai");
  });

  it("allows proxy endpoints to explicitly select DeepSeek compatibility", () => {
    expect(
      resolveCompatibility({ ...config, baseUrl: "https://gateway.example.com/v1", compatibility: "deepseek" }),
    ).toBe("deepseek");
  });
});

function bookmark(id: string, title = "Title", url = `https://example.com/${id}`): ExtractedBookmark {
  return {
    id,
    title,
    url,
    folderPath: [],
    attributes: {
      href: url,
    },
    isWebUrl: true,
  };
}
