import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskRequestSchema, type TaskEvent } from "@marksweep/core/protocol";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";
import { runTask } from "../../apps/server/src/tasks";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  vi.unstubAllEnvs();
});

const bookmarks = parseBookmarkHtml(
  '<DL><DT><A HREF="https://example.com/a">A</A><DT><A HREF="https://example.com/b">B</A></DL>',
).bookmarks;

async function localModel() {
  const requests: Array<{ stream?: boolean; messages: Array<{ role: string; content: unknown }> }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as (typeof requests)[number];
    const step = requests.length % 3;
    const round = Math.floor(requests.length / 3) + 1;
    requests.push(body);
    const delta =
      step === 0
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `progress-${round}`,
                type: "function",
                function: {
                  name: round === 1 ? "report_progress" : "find_bookmarks",
                  arguments: JSON.stringify(
                    round === 1 ? { message: `第${round}轮正在核实分类要求。` } : { keywords: ["开发"], offset: 0 },
                  ),
                },
              },
            ],
          }
        : step === 1
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `submit-${round}`,
                  type: "function",
                  function: {
                    name: "submit_organization",
                    arguments: JSON.stringify({
                      summary: `第${round}轮整理完成`,
                      assignments: bookmarks.map((bookmark) => ({
                        id: bookmark.id,
                        title: bookmark.title,
                        folderPath: [round === 1 ? "开发" : "前端"],
                        reason: "按用户要求",
                      })),
                    }),
                  },
                },
              ],
            }
          : { role: "assistant", content: `第${round}轮已经完成，可以查看结果。` };
    if (!body.stream) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          model: "local-test",
          choices: [
            {
              message: { ...delta, reasoning_content: "核实当前要求" },
              finish_reason: step === 2 ? "stop" : "tool_calls",
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: `response-${requests.length}`, object: "chat.completion.chunk", model: "local-test", created: 1, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
    );
    response.end(
      `data: ${JSON.stringify({ id: `response-${requests.length}`, object: "chat.completion.chunk", model: "local-test", created: 1, choices: [{ index: 0, delta: {}, finish_reason: step === 2 ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

describe("Deep Agents conversation through the real model adapter", () => {
  it.each(["openai", "deepseek"] as const)(
    "%s: streams tool and text events, keeps IDs, and refines a previous version",
    async (compatibility) => {
      vi.stubEnv("LANGSMITH_TRACING", "false");
      vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
      vi.stubEnv("MARKSWEEP_CONFIG_PATH", "/nonexistent/marksweep-conversation-config.json");
      const model = await localModel();
      const request = taskRequestSchema.parse({
        type: "run",
        requestId: "round1",
        task: "organize",
        bookmarks,
        conversation: { id: "76df7cb8-06df-4e23-89a0-5388d7db89aa", instruction: "最多两级" },
        ai: { baseUrl: model.baseUrl, model: "local-test", apiKey: "test-key", compatibility },
        options: { maxPages: 0, langsmith: false },
      });
      const events: TaskEvent[] = [];
      await runTask(request, (event) => events.push(event), new AbortController().signal);
      const completed = events.find((event) => event.type === "complete");
      if (completed?.type !== "complete" || !completed.bookmarks || !completed.organization)
        throw new Error("missing result");
      expect(completed.bookmarks.map((bookmark) => bookmark.id)).toEqual(bookmarks.map((bookmark) => bookmark.id));
      expect(completed.bookmarks[0]!.folderPath).toEqual(["开发"]);
      expect(
        events.some(
          (event) =>
            event.type === "activity" && event.activity.kind === "tool" && event.activity.status === "complete",
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === "activity" &&
            event.activity.kind === "tool" &&
            event.activity.name === "submit_organization",
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === "activity" &&
            event.activity.kind === "message" &&
            event.activity.text.includes("进度已展示"),
        ),
      ).toBe(false);
      expect(
        events.some(
          (event) =>
            event.type === "activity" && event.activity.kind === "message" && event.activity.text.includes("可以查看"),
        ),
      ).toBe(true);
      expect(
        events.filter(
          (event) =>
            event.type === "activity" &&
            event.activity.kind === "timing" &&
            event.activity.phase === "model" &&
            event.activity.status === "complete",
        ),
      ).toHaveLength(3);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "activity",
          activity: expect.objectContaining({ kind: "timing", phase: "total", status: "complete" }),
        }),
      );
      const sequences = events.flatMap((event) => (event.type === "activity" ? [event.sequence] : []));
      expect(sequences).toEqual(sequences.map((_, index) => index + 1));
      const next: TaskEvent[] = [];
      await runTask(
        {
          ...request,
          requestId: "round2",
          bookmarks: completed.bookmarks,
          conversation: {
            ...request.conversation!,
            instruction: "改成前端目录",
            history: [
              { role: "user", content: "最多两级" },
              { role: "assistant", content: completed.organization.summary },
            ],
          },
        },
        (event) => next.push(event),
        new AbortController().signal,
      );
      expect(next.at(-1)).toMatchObject({
        type: "complete",
        bookmarks: [{ folderPath: ["前端"] }, { folderPath: ["前端"] }],
      });
      expect(JSON.stringify(model.requests[3]!.messages)).toContain("最多两级");
      expect(JSON.stringify(model.requests[3]!.messages)).toContain("开发");
      expect(JSON.stringify(model.requests[3]!.messages)).not.toContain(bookmarks[0]!.url);
      expect(JSON.stringify(model.requests[4]!.messages)).toContain(bookmarks[0]!.url);
      expect(next).toContainEqual(
        expect.objectContaining({
          type: "activity",
          activity: expect.objectContaining({ kind: "tool", name: "find_bookmarks", status: "complete" }),
        }),
      );
      expect(bookmarks[0]!.folderPath).toEqual([]);
      expect(completed.bookmarks[0]!.folderPath).toEqual(["开发"]);
    },
    15000,
  );
});
