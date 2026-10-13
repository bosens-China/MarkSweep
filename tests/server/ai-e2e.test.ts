import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTask } from "../../apps/server/src/tasks";
import { taskRequestSchema, type TaskEvent } from "@marksweep/core/protocol";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  vi.unstubAllEnvs();
});

async function localModel() {
  const requests: Array<{ stream?: boolean; tools?: Array<{ function?: { name?: string } }> }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as (typeof requests)[number];
    requests.push(body);
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const text of ["# 疑似过时书签\n\n", "未发现有充分证据的过时内容。"])
        response.write(
          `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
        );
      response.end(
        `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          model: "local-test",
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "submit",
                    type: "function",
                    function: {
                      name: "submit_bookmark_classification",
                      arguments: JSON.stringify({ folders: [{ title: "开发", bookmarks: [1, 2], children: [] }] }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
    }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

describe("real AI adapters through the task runner", () => {
  it("classifies every bookmark and streams an audit through a local compatible API", async () => {
    vi.stubEnv("LANGSMITH_TRACING", "false");
    vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
    const model = await localModel();
    const bookmarks = parseBookmarkHtml(
      '<DL><p><DT><A HREF="https://example.com/one">One</A><DT><A HREF="https://example.com/two">Two</A></DL>',
    ).bookmarks;
    const request = taskRequestSchema.parse({
      type: "run",
      requestId: "classification",
      task: "classify",
      bookmarks,
      ai: { baseUrl: model.baseUrl, model: "local-test", apiKey: "local-test-key", compatibility: "deepseek" },
      options: { maxPages: 0, langsmith: false },
    });
    const events: TaskEvent[] = [];
    await runTask(request, (event) => events.push(event), new AbortController().signal);
    const completed = events.find((event) => event.type === "complete");
    expect(completed?.type === "complete" && completed.bookmarks?.map((bookmark) => bookmark.folderPath)).toEqual([
      ["开发"],
      ["开发"],
    ]);
    expect(model.requests[0]?.tools?.some((tool) => tool.function?.name === "submit_bookmark_classification")).toBe(
      true,
    );

    const audit: TaskEvent[] = [];
    await runTask(
      { ...request, requestId: "audit", task: "audit" },
      (event) => audit.push(event),
      new AbortController().signal,
    );
    const tokens = audit.flatMap((event) => (event.type === "token" ? [event.token] : []));
    expect(tokens.join("")).toBe("# 疑似过时书签\n\n未发现有充分证据的过时内容。");
    expect(audit.at(-1)).toMatchObject({ type: "complete", report: tokens.join("") });
    expect(model.requests).toHaveLength(2);
  });
});
