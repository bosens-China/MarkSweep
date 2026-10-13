import { randomUUID } from "node:crypto";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { isAIMessage } from "@langchain/core/messages";
import type { ChatGeneration } from "@langchain/core/outputs";
import type { AgentActivity } from "./schema.js";

type Timing = Extract<AgentActivity, { kind: "timing" }>;

export function createActivityObserver(emit: (activity: AgentActivity) => void, now = () => performance.now()) {
  const modelRuns = new Map<string, { started: number; value: Timing }>();
  const tools = new Map<string, { started: number; name: string }>();
  const started = now();
  const totalId = randomUUID();
  let modelNumber = 0;
  const firstResponse = (runId: string) => {
    const run = modelRuns.get(runId);
    if (!run || run.value.firstTokenMs !== undefined) return;
    run.value.firstTokenMs = Math.round(now() - run.started);
    emit({ ...run.value, elapsedMs: run.value.firstTokenMs });
  };
  const endModel = (
    runId: string,
    status: "complete" | "error",
    usage?: { input_tokens: number; output_tokens: number },
  ) => {
    const run = modelRuns.get(runId);
    if (!run) return;
    emit({
      ...run.value,
      status,
      elapsedMs: Math.round(now() - run.started),
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    });
    modelRuns.delete(runId);
  };
  const endTool = (runId: string, error?: Error) => {
    const run = tools.get(runId);
    if (!run) return;
    emit({
      kind: "tool",
      id: runId,
      name: run.name,
      status: error ? "error" : "complete",
      text: error?.message.slice(0, 500) ?? "执行完成",
      elapsedMs: Math.round(now() - run.started),
    });
    tools.delete(runId);
  };
  const methods = {
    handleChatModelStart(_model, _messages, runId) {
      const value: Timing = {
        kind: "timing",
        id: `model:${runId}`,
        name: `模型请求 ${++modelNumber}`,
        phase: "model",
        status: "running",
        elapsedMs: 0,
      };
      modelRuns.set(runId, { started: now(), value });
      emit(value);
    },
    handleLLMNewToken(_token, _indices, runId) {
      firstResponse(runId);
    },
    handleChatModelStreamEvent(event, runId) {
      if (event.event === "content-block-start" || event.event === "content-block-delta") firstResponse(runId);
    },
    handleLLMEnd(output, runId) {
      const message = (output.generations[0]?.[0] as ChatGeneration | undefined)?.message;
      endModel(runId, "complete", message && isAIMessage(message) ? message.usage_metadata : undefined);
    },
    handleLLMError(_error: unknown, runId) {
      endModel(runId, "error");
    },
    handleToolStart(serialized, _input, runId, _parent, _tags, _metadata, runName) {
      const name = runName ?? serialized.name ?? "工具";
      tools.set(runId, { started: now(), name });
      emit({ kind: "tool", id: runId, name, status: "running", text: "正在执行" });
    },
    handleToolEnd(_output, runId) {
      endTool(runId);
    },
    handleToolError(error: Error, runId) {
      endTool(runId, error);
    },
  } satisfies Parameters<typeof BaseCallbackHandler.fromMethods>[0];
  emit({ kind: "timing", id: totalId, name: "本轮总耗时", phase: "total", status: "running", elapsedMs: 0 });
  return {
    methods,
    finish(success: boolean) {
      for (const runId of modelRuns.keys()) endModel(runId, "error");
      for (const runId of tools.keys()) endTool(runId, new Error("执行已中断"));
      emit({
        kind: "timing",
        id: totalId,
        name: "本轮总耗时",
        phase: "total",
        status: success ? "complete" : "error",
        elapsedMs: Math.round(now() - started),
      });
    },
  };
}
