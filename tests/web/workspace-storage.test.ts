import { describe, expect, it } from "vitest";
import { workspaceSnapshotSchema } from "../../apps/web/src/workspace-storage";

const snapshot = {
  version: 1,
  filename: "bookmarks.html",
  title: "Bookmarks",
  bookmarks: [],
  original: [],
  results: {},
  report: "partial report",
  traceUrl: "",
  task: "audit",
};

describe("workspace recovery data", () => {
  it("keeps partial work while excluding AI settings and API keys", () => {
    const parsed = workspaceSnapshotSchema.parse({
      ...snapshot,
      ai: { apiKey: "secret" },
      settings: { ai: { apiKey: "secret" } },
    });
    expect(parsed.report).toBe("partial report");
    expect(parsed.task).toBe("audit");
    expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(parsed).not.toHaveProperty("settings");
  });
  it("rejects damaged snapshots and unsafe trace links", () => {
    expect(workspaceSnapshotSchema.safeParse({ ...snapshot, bookmarks: [null] }).success).toBe(false);
    expect(workspaceSnapshotSchema.safeParse({ ...snapshot, traceUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});
