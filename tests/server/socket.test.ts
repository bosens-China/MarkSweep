import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/server/src/app";
import type { TaskDependencies } from "../../apps/server/src/tasks";
import { taskRequestSchema, type TaskEvent } from "@marksweep/core/protocol";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";

const bookmarks = parseBookmarkHtml('<DL><p><DT><A HREF="https://example.com">Example</A></DL>').bookmarks;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllEnvs();
});

async function connect(dependencies: TaskDependencies) {
  const origins = new Set<string>();
  const app = createApp(origins, dependencies);
  const wss = new WebSocketServer({ noServer: true });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0, websocket: { server: wss } }) as Server;
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  const origin = `http://127.0.0.1:${address.port}`;
  origins.add(origin);
  const socket = new WebSocket(origin.replace("http", "ws") + "/ws", { origin });
  cleanups.push(() => {
    socket.terminate();
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close();
  });
  await once(socket, "open");
  return { socket, origin };
}

function until(socket: WebSocket, terminal: string) {
  return new Promise<TaskEvent[]>((resolve, reject) => {
    const events: TaskEvent[] = [];
    const timeout = setTimeout(() => reject(new Error("WebSocket test timed out")), 3000);
    const listener = (data: Buffer) => {
      const event = JSON.parse(data.toString()) as TaskEvent;
      events.push(event);
      if (event.type === terminal) {
        clearTimeout(timeout);
        socket.off("message", listener);
        resolve(events);
      }
    };
    socket.on("message", listener);
  });
}

function dependencies(): TaskDependencies {
  return { checkBookmarks: vi.fn(), classifyBookmarks: vi.fn(), auditBookmarks: vi.fn() };
}

describe("WebSocket tasks", () => {
  it("streams check results and a summary through a real connection", async () => {
    const deps = dependencies();
    deps.checkBookmarks = vi.fn(async (input, _options, context) => {
      const result = { bookmark: input[0]!, status: "valid" as const, reason: "ok" as const, attempts: 1 };
      context?.onProgress?.({ bookmark: input[0]!, result, index: 0, completed: 1, total: 1 });
      return [result];
    });
    const { socket } = await connect(deps);
    const received = until(socket, "complete");
    socket.send(
      JSON.stringify(taskRequestSchema.parse({ type: "run", requestId: "check-1", task: "check", bookmarks })),
    );
    const events = await received;
    expect(events.map((event) => event.type)).toEqual(["check", "progress", "complete"]);
    expect(events.at(-1)).toMatchObject({ requestId: "check-1", summary: { valid: 1, total: 1 } });
  });
  it("cancels in-flight work and permits another task", async () => {
    const deps = dependencies();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    deps.checkBookmarks = vi.fn<TaskDependencies["checkBookmarks"]>(
      async (_input, _options, context) =>
        new Promise((_, reject) => {
          context?.signal?.addEventListener("abort", () => reject(context.signal?.reason), { once: true });
          started();
        }),
    );
    const { socket } = await connect(deps);
    const request = taskRequestSchema.parse({ type: "run", requestId: "cancel-1", task: "check", bookmarks });
    const received = until(socket, "cancelled");
    socket.send(JSON.stringify(request));
    await ready;
    socket.send(JSON.stringify({ type: "cancel", requestId: request.requestId }));
    expect((await received).at(-1)).toEqual({ type: "cancelled", requestId: request.requestId });
    deps.checkBookmarks = vi.fn(async () => []);
    const next = until(socket, "complete");
    socket.send(JSON.stringify({ ...request, requestId: "check-after-cancel" }));
    expect((await next).at(-1)).toMatchObject({ type: "complete", requestId: "check-after-cancel" });
    const errors = until(socket, "error");
    socket.send("invalid json");
    expect((await errors).at(-1)).toMatchObject({ type: "error" });
  });
  it("streams audit text and returns errors without terminating the connection", async () => {
    vi.stubEnv("MARKSWEEP_CONFIG_PATH", "/nonexistent/marksweep-test-config.json");
    vi.stubEnv("LANGSMITH_TRACING", "false");
    const deps = dependencies();
    deps.auditBookmarks = vi.fn(async (_bookmarks, _config, options) => {
      options?.onToken?.("# 报告");
      return "# 报告";
    });
    const { socket } = await connect(deps);
    const request = taskRequestSchema.parse({
      type: "run",
      requestId: "audit-1",
      task: "audit",
      bookmarks,
      ai: { baseUrl: "https://api.example.com/v1", model: "test", apiKey: "test-key" },
    });
    const received = until(socket, "complete");
    socket.send(JSON.stringify(request));
    expect((await received).map((event) => event.type)).toEqual(["token", "complete"]);
    expect(deps.auditBookmarks).toHaveBeenCalledOnce();
    const errors = until(socket, "error");
    socket.send(JSON.stringify({ ...request, requestId: "invalid", options: { maxPages: -1 } }));
    expect((await errors).at(-1)).toMatchObject({ type: "error" });
  });
});
