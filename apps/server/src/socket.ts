import type { WSEvents } from "hono/ws";
import { clientMessageSchema, type TaskEvent } from "@marksweep/core/protocol";
import { runTask, type TaskDependencies } from "./tasks.js";
import type { PageCache } from "@marksweep/core/conversation/page-tools";

export function createTaskSocket(dependencies?: TaskDependencies): WSEvents {
  let active: { requestId: string; controller: AbortController } | undefined;
  let conversationId = "";
  const pageCache: PageCache = new Map();
  return {
    onMessage(event, socket) {
      const emit = (message: TaskEvent) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(message));
      };
      let value: unknown;
      try {
        value = JSON.parse(String(event.data)) as unknown;
      } catch {
        emit({ type: "error", requestId: "", message: "无效的 JSON 消息。" });
        return;
      }
      const parsed = clientMessageSchema.safeParse(value);
      if (!parsed.success) {
        emit({ type: "error", requestId: "", message: "任务参数无效，请检查设置。" });
        return;
      }
      const message = parsed.data;
      if (message.type === "cancel") {
        if (active?.requestId === message.requestId) active.controller.abort(new Error("任务已取消。"));
        return;
      }
      if (active) {
        emit({ type: "error", requestId: message.requestId, message: "请等待当前任务结束。" });
        return;
      }
      const controller = new AbortController();
      if (message.conversation && message.conversation.id !== conversationId) {
        pageCache.clear();
        conversationId = message.conversation?.id ?? "";
      }
      active = { requestId: message.requestId, controller };
      void runTask(message, emit, controller.signal, dependencies, pageCache)
        .catch((error: unknown) => {
          emit(
            controller.signal.aborted
              ? { type: "cancelled", requestId: message.requestId }
              : {
                  type: "error",
                  requestId: message.requestId,
                  message: error instanceof Error ? error.message : "任务失败。",
                },
          );
        })
        .finally(() => {
          active = undefined;
        });
    },
    onClose() {
      active?.controller.abort(new Error("浏览器连接已关闭。"));
    },
    onError() {
      active?.controller.abort(new Error("浏览器连接异常。"));
    },
  };
}
