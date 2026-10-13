import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { OpenAICompatibleChatModel } from "@marksweep/core/classifier/openai-compatible-model";

describe("OpenAI compatible reasoning round trips", () => {
  it.each([true, false])("preserves reasoning for tool messages, streaming=%s", async (stream) => {
    const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const model = new OpenAICompatibleChatModel({
      apiKey: "test-key",
      model: "any-provider-model",
      maxRetries: 0,
      configuration: {
        baseURL: "https://example.com/v1",
        fetch: async (_input: unknown, init?: RequestInit) => {
          requests.push(JSON.parse(String(init?.body)) as (typeof requests)[number]);
          return stream
            ? new Response(
                `data: ${JSON.stringify({ id: "answer", model: "any-provider-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
              )
            : new Response(
                JSON.stringify({
                  model: "any-provider-model",
                  choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
                }),
                { headers: { "content-type": "application/json" } },
              );
        },
      },
    });
    const messages = [
      new HumanMessage("核实用途"),
      new AIMessage({
        content: "",
        additional_kwargs: { reasoning_content: "需要读取页面" },
        tool_calls: [{ id: "read-1", name: "read", args: {} }],
      }),
      new ToolMessage({ content: "页面正文", tool_call_id: "read-1" }),
    ];
    if (stream) {
      for await (const chunk of await model.stream(messages)) expect(chunk.content).toBeDefined();
    } else expect((await model.invoke(messages)).content).toBe("OK");
    expect(requests[0]!.messages).toContainEqual(
      expect.objectContaining({ role: "assistant", reasoning_content: "需要读取页面" }),
    );
    expect(requests[0]!.messages.at(-1)).not.toHaveProperty("reasoning_content");
  });
});
