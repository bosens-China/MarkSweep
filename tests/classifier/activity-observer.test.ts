import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { createActivityObserver } from "@marksweep/core/conversation/activity-observer";
import type { AgentActivity } from "@marksweep/core/conversation/schema";

const serialized = { lc: 1 as const, type: "not_implemented" as const, id: ["test"] };
describe("execution timing", () => {
  it("records model response latency, tokens, tool time and total independently", () => {
    let time = 0;
    const events: AgentActivity[] = [];
    const observer = createActivityObserver(
      (event) => events.push({ ...event }),
      () => time,
    );
    observer.methods.handleChatModelStart(serialized, [], "model1");
    time = 200;
    observer.methods.handleLLMNewToken("", { prompt: 0, completion: 0 }, "model1");
    time = 300;
    observer.methods.handleLLMNewToken("more", { prompt: 0, completion: 0 }, "model1");
    time = 700;
    const generation = {
      text: "done",
      message: new AIMessage({
        content: "done",
        usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }),
    };
    observer.methods.handleLLMEnd({ generations: [[generation]] }, "model1");
    observer.methods.handleToolStart(serialized, "{}", "tool1", undefined, undefined, undefined, "read_pages");
    time = 950;
    observer.methods.handleToolEnd("done", "tool1");
    observer.finish(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "timing",
        phase: "model",
        status: "complete",
        elapsedMs: 700,
        firstTokenMs: 200,
        inputTokens: 100,
        outputTokens: 20,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "tool", name: "read_pages", status: "complete", elapsedMs: 250 }),
    );
    expect(events.at(-1)).toMatchObject({ kind: "timing", phase: "total", elapsedMs: 950, status: "complete" });
  });
  it("finishes active operations on failure without inventing usage or first-token measurements", () => {
    let time = 0;
    const events: AgentActivity[] = [];
    const observer = createActivityObserver(
      (event) => events.push(event),
      () => time,
    );
    observer.methods.handleChatModelStart(serialized, [], "model1");
    observer.methods.handleToolStart(serialized, "{}", "tool1", undefined, undefined, undefined, "read_pages");
    time = 100;
    observer.finish(false);
    expect(events.filter((event) => event.kind === "timing" && event.status === "error")).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ kind: "tool", status: "error", elapsedMs: 100 }));
    const model = events.find(
      (event) => event.kind === "timing" && event.phase === "model" && event.status === "error",
    );
    expect(model).not.toHaveProperty("firstTokenMs");
    expect(model).toHaveProperty("inputTokens", undefined);
  });
});
