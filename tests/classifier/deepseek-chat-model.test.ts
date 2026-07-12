import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DeepSeekChatModel } from "../../src/classifier/deepseek-chat-model";
import { BookmarkClassificationSchema } from "../../src/classifier/types";

describe("DeepSeekChatModel", () => {
  it("works with createAgent without tool_choice and preserves reasoning_content", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      {
        model: "deepseek-v4-pro",
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "需要抓取页面",
              tool_calls: [toolCall("call-fetch", "fetch_web_page", { url: "https://example.com" })],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        model: "deepseek-v4-pro",
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "分类完成",
              tool_calls: [
                toolCall("call-submit", "submit_bookmark_classification", {
                  folders: [{ title: "开发", bookmarks: [1], children: [] }],
                }),
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ];
    const fetcher = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      requests.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return new Response(JSON.stringify(responses.shift()), { status: 200 }) as never;
    });
    const fetchWebPage = tool(async () => "page content", {
      name: "fetch_web_page",
      description: "fetch",
      schema: z.object({ url: z.string() }),
    });
    const agent = createAgent({
      model: new DeepSeekChatModel({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        fetcher: fetcher as never,
      }),
      tools: [fetchWebPage],
      responseFormat: BookmarkClassificationSchema,
      systemPrompt: "按需抓取，最后提交分类。",
    });

    const result = await agent.invoke({ messages: [{ role: "user", content: "classify" }] });

    expect(result.structuredResponse).toEqual({
      folders: [{ title: "开发", bookmarks: [1], children: [] }],
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).not.toHaveProperty("tool_choice");
    expect(requests[1]).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "assistant", reasoning_content: "需要抓取页面" }),
          expect.objectContaining({ role: "tool", tool_call_id: "call-fetch" }),
        ]),
      }),
    );
  });

  it("surfaces API errors", async () => {
    const model = new DeepSeekChatModel({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      fetcher: async () =>
        new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }) as never,
    });

    await expect(model.invoke("hello")).rejects.toThrow("400 bad request");
  });
});

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}
