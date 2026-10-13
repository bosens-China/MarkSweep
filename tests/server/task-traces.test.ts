import { afterEach, describe, expect, it, vi } from "vitest";
import { runTask, type TaskDependencies } from "../../apps/server/src/tasks";
import { taskRequestSchema, type TaskEvent } from "@marksweep/core/protocol";

const trace = vi.hoisted(() => ({ flush: vi.fn(), url: vi.fn() }));
vi.mock("@marksweep/core/observability/langsmith", () => ({
  resolveLangSmithConfig: () => ({ enabled: true }),
  createLangSmithRuntime: () => ({ callbacks: [] }),
  flushLangSmithRuntime: trace.flush,
  getLangSmithProjectUrl: trace.url,
}));
afterEach(() => vi.resetAllMocks());

const request = () =>
  taskRequestSchema.parse({
    type: "run",
    requestId: "trace-test",
    task: "audit",
    bookmarks: [],
    ai: { baseUrl: "https://api.example.com/v1", model: "test", apiKey: "test-key" },
  });
const deps = (): TaskDependencies => ({
  checkBookmarks: vi.fn(),
  classifyBookmarks: vi.fn(),
  auditBookmarks: vi.fn(async () => "# Report"),
});

describe("task trace links", () => {
  it("emits the trace link and flush warning before task completion", async () => {
    trace.url.mockResolvedValue("https://smith.langchain.com/o/project");
    trace.flush.mockResolvedValue(new Error("trace unavailable"));
    const events: TaskEvent[] = [];
    await runTask(request(), (event) => events.push(event), new AbortController().signal, deps());
    expect(events.map((event) => event.type)).toEqual(["trace", "warning", "complete"]);
    expect(events[0]).toMatchObject({ url: "https://smith.langchain.com/o/project", requestId: "trace-test" });
  });
  it("does not expose unsafe trace URLs or discard successful AI results", async () => {
    trace.url.mockResolvedValue("javascript:alert(1)");
    trace.flush.mockResolvedValue(undefined);
    const events: TaskEvent[] = [];
    await runTask(request(), (event) => events.push(event), new AbortController().signal, deps());
    expect(events).toEqual([{ type: "complete", requestId: "trace-test", report: "# Report" }]);
  });
});
