import { describe, expect, it, vi } from "vitest";
import {
  classificationToHtmlDocument,
  classifyBookmarksWithModel,
  parseClassificationResult,
  validateClassification,
  type ToolCallingModelLike,
} from "../../src/classifier/bookmark-classifier";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("classification validation", () => {
  it("throws when the AI response misses a bookmark", () => {
    expect(() =>
      validateClassification([bookmark("a"), bookmark("b")], {
        folders: [{ title: "Dev", bookmarks: ["https://example.com/a"], children: [] }],
      }),
    ).toThrow("缺失 URL：https://example.com/b");
  });

  it("throws on duplicate bookmark URLs", () => {
    expect(() =>
      validateClassification([bookmark("a")], {
        folders: [{ title: "Dev", bookmarks: ["https://example.com/a", "https://example.com/a"], children: [] }],
      }),
    ).toThrow("重复 URL：https://example.com/a");
  });

  it("converts classification folders to a renderable document", () => {
    const document = classificationToHtmlDocument([bookmark("a"), bookmark("b")], {
      folders: [
        {
          title: "开发",
          bookmarks: ["https://example.com/a"],
          children: [{ title: "文档", bookmarks: ["https://example.com/b"], children: [] }],
        },
      ],
    });

    expect(document.folders[0]?.title).toBe("开发");
    expect(document.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["a"]);
    expect(document.folders[0]?.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["b"]);
  });

  it("matches classified bookmarks by normalized URL", () => {
    const document = classificationToHtmlDocument([bookmark("a", "Title", "https://example.com/a/")], {
      folders: [{ title: "开发", bookmarks: ["https://example.com/a"], children: [] }],
    });

    expect(document.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["a"]);
  });

  it("parses JSON classification returned as model text", () => {
    expect(
      parseClassificationResult(
        '```json\n{"folders":[{"title":"开发","bookmarks":["https://example.com/a"],"children":[]}]}\n```',
      ),
    ).toEqual({
      folders: [{ title: "开发", bookmarks: ["https://example.com/a"], children: [] }],
    });
  });
});

describe("classifyBookmarksWithModel", () => {
  it("lets the model decide whether to call the fetch_web_page tool", async () => {
    const boundInvoke = vi.fn(async () => ({
      tool_calls: [{ name: "fetch_web_page", args: { url: "https://example.com" } }],
    }));
    const invoke = vi.fn(
      async () => '{"folders":[{"title":"其他","bookmarks":["https://example.com"],"children":[]}]}',
    );
    const model: ToolCallingModelLike = {
      invoke,
      bindTools: vi.fn(() => ({ invoke: boundInvoke })),
    };

    const document = await classifyBookmarksWithModel([bookmark("a", "首页", "https://example.com")], model, {
      fetcherOptions: {
        fetcher: async () =>
          new Response(`Title: Example\nURL Source: https://example.com\n\nExample page content`, {
            status: 200,
          }) as never,
      },
      maxToolCalls: 1,
    });

    expect(model.bindTools).toHaveBeenCalled();
    expect(boundInvoke).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
    expect(document.folders[0]?.title).toBe("其他");
  });

  it("continues classification when a requested webpage fetch fails", async () => {
    const boundInvoke = vi.fn(async () => ({
      tool_calls: [{ name: "fetch_web_page", args: { url: "https://example.com" } }],
    }));
    const invoke = vi.fn(async () => ({
      folders: [{ title: "其他", bookmarks: ["https://example.com"], children: [] }],
    }));
    const model: ToolCallingModelLike = {
      invoke,
      bindTools: vi.fn(() => ({ invoke: boundInvoke })),
    };

    const document = await classifyBookmarksWithModel([bookmark("a", "首页", "https://example.com")], model, {
      fetcherOptions: {
        fetcher: async () => new Response("nope", { status: 500 }) as never,
      },
      maxToolCalls: 1,
    });

    expect(boundInvoke).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
    expect(document.folders[0]?.bookmarks.map((item) => item.id)).toEqual(["a"]);
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
