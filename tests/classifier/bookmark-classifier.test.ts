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

  it("parses JSON classification returned as model text", () => {
    expect(
      parseClassificationResult('```json\n{"folders":[{"title":"开发","bookmarks":[1],"children":[]}]}\n```'),
    ).toEqual({
      folders: [{ title: "开发", bookmarks: [1], children: [] }],
    });
  });
});

describe("classifyBookmarksWithModel", () => {
  it("injects the requested response language into the Chinese prompt", async () => {
    const invoke = vi.fn(async () => ({
      folders: [{ title: "Development", bookmarks: [1], children: [] }],
    }));

    await classifyBookmarksWithModel([bookmark("a")], { invoke }, { lang: "English", maxToolCalls: 0 });

    expect(invoke.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([["system", expect.stringContaining("回复语言以 English 为准")]]),
    );
  });

  it("lets the model decide whether to call the fetch_web_page tool", async () => {
    const boundInvoke = vi.fn(async () => ({
      tool_calls: [{ name: "fetch_web_page", args: { url: "https://example.com" } }],
    }));
    const invoke = vi.fn(async () => '{"folders":[{"title":"其他","bookmarks":[1],"children":[]}]}');
    const model: ToolCallingModelLike = {
      invoke,
      bindTools: vi.fn(() => ({ invoke: boundInvoke })),
    };
    const onProgress = vi.fn();
    const inputBookmark = bookmark("a", "首页", "https://example.com");
    inputBookmark.folderPath = ["旧目录", "AI"];

    const document = await classifyBookmarksWithModel([inputBookmark], model, {
      fetcherOptions: {
        fetcher: async () =>
          new Response(`Title: Example\nURL Source: https://example.com\n\nExample page content`, {
            status: 200,
          }) as never,
      },
      maxToolCalls: 1,
      onProgress,
    });

    expect(model.bindTools).toHaveBeenCalled();
    expect(boundInvoke).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
    expect(invoke.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        ["system", expect.stringContaining("回复语言以 中文 为准")],
        ["human", expect.stringContaining('"id": 1')],
      ]),
    );
    expect(invoke.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([["system", expect.stringContaining("默认使用简洁的中文名词")]]),
    );
    expect(invoke.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([["system", expect.stringContaining("软性建议")]]),
    );
    expect(invoke.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([["human", expect.stringContaining('"original_path"')]]),
    );
    expect(invoke.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([["human", expect.stringContaining("旧目录")]]));
    expect(onProgress).toHaveBeenCalledWith("正在判断是否需要抓取网页内容⋯⋯");
    expect(onProgress).toHaveBeenCalledWith("正在抓取网页 1/1：首页");
    expect(onProgress).toHaveBeenLastCalledWith("正在校验分类结果⋯⋯");
    expect(document.folders[0]?.title).toBe("其他");
  });

  it("continues classification when a requested webpage fetch fails", async () => {
    const boundInvoke = vi.fn(async () => ({
      tool_calls: [{ name: "fetch_web_page", args: { url: "https://example.com" } }],
    }));
    const invoke = vi.fn(async () => ({
      folders: [{ title: "其他", bookmarks: [1], children: [] }],
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

  it("allows multiple tool calls up to maxToolCalls", async () => {
    const boundInvoke = vi.fn(async () => ({
      tool_calls: [
        { name: "fetch_web_page", args: { url: "https://example.com/a" } },
        { name: "fetch_web_page", args: { url: "https://example.com/b" } },
        { name: "fetch_web_page", args: { url: "https://example.com/c" } },
      ],
    }));
    const invoke = vi.fn(async () => ({
      folders: [{ title: "其他", bookmarks: [1, 2, 3], children: [] }],
    }));
    const fetcher = vi.fn(async () => new Response("Title: Example\n\nBody", { status: 200 }) as never);
    const model: ToolCallingModelLike = {
      invoke,
      bindTools: vi.fn(() => ({ invoke: boundInvoke })),
    };

    await classifyBookmarksWithModel(
      [
        bookmark("a", "首页", "https://example.com/a"),
        bookmark("b", "首页", "https://example.com/b"),
        bookmark("c", "首页", "https://example.com/c"),
      ],
      model,
      { fetcherOptions: { fetcher }, maxToolCalls: 2 },
    );

    expect(model.bindTools).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ parallel_tool_calls: true }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
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
