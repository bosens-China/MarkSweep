import { describe, expect, it } from "vitest";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";
import {
  conversationHistory,
  receiveConversationEvent,
  recoverConversation,
  bookmarkChanges,
  type ConversationState,
} from "../../apps/web/src/conversation-state";
import { workspaceSnapshotSchema } from "../../apps/web/src/workspace-storage";

const before = parseBookmarkHtml('<DL><DT><A HREF="https://example.com">A</A></DL>').bookmarks;
const initial: ConversationState = {
  id: "conversation",
  turns: [{ requestId: "round1", instruction: "分两级", before, status: "running", activities: [], lastSequence: 0 }],
};

describe("conversation versions and events", () => {
  it("merges interleaved messages and parallel tools by ID, ignoring duplicate events", () => {
    let state = receiveConversationEvent(initial, {
      type: "activity",
      requestId: "round1",
      sequence: 1,
      activity: { kind: "message", id: "m1", channel: "text", text: "先" },
    });
    state = receiveConversationEvent(state, {
      type: "activity",
      requestId: "round1",
      sequence: 2,
      activity: { kind: "tool", id: "t1", name: "读取", status: "running", text: "开始" },
    });
    const delta = {
      type: "activity" as const,
      requestId: "round1",
      sequence: 3,
      activity: { kind: "message" as const, id: "m1", channel: "text" as const, text: "核实" },
    };
    state = receiveConversationEvent(receiveConversationEvent(state, delta), delta);
    expect(state.turns[0]!.activities).toHaveLength(2);
    expect(state.turns[0]!.activities[0]).toMatchObject({ text: "先核实" });
    expect(initial.turns[0]!.activities).toEqual([]);
  });
  it("replaces timing snapshots, persists evidence sources and stops active clocks on recovery", () => {
    let state = receiveConversationEvent(initial, {
      type: "activity",
      requestId: "round1",
      sequence: 1,
      activity: { kind: "timing", id: "model", name: "模型请求 1", phase: "model", status: "running", elapsedMs: 0 },
    });
    state = receiveConversationEvent(state, {
      type: "activity",
      requestId: "round1",
      sequence: 2,
      activity: {
        kind: "timing",
        id: "model",
        name: "模型请求 1",
        phase: "model",
        status: "running",
        elapsedMs: 200,
        firstTokenMs: 200,
      },
    });
    state = receiveConversationEvent(state, {
      type: "activity",
      requestId: "round1",
      sequence: 3,
      activity: {
        kind: "tool",
        id: "page",
        name: "读取网页",
        status: "complete",
        text: "核实出处",
        elapsedMs: 300,
        url: "https://other.example/",
        sourceUrl: "https://example.com/",
      },
    });
    expect(state.turns[0]!.activities).toHaveLength(2);
    expect(recoverConversation(state).turns[0]!.activities[0]).toMatchObject({
      kind: "timing",
      elapsedMs: 200,
      status: "error",
    });
    expect(JSON.parse(JSON.stringify(state)).turns[0].activities[1]).toMatchObject({
      url: "https://other.example/",
      sourceUrl: "https://example.com/",
    });
  });
  it("keeps immutable historical results, produces readable changes and carries requirements forward", () => {
    const bookmarks = before.map((bookmark) => ({ ...bookmark, folderPath: ["开发"] }));
    const organization = {
      summary: "已归入开发",
      assignments: [{ id: before[0]!.id, title: "A", folderPath: ["开发"], reason: "用途相同" }],
    };
    const state = receiveConversationEvent(initial, { type: "complete", requestId: "round1", bookmarks, organization });
    expect(bookmarkChanges(state.turns[0]!)[0]).toMatchObject({
      before: { folderPath: [] },
      after: { folderPath: ["开发"] },
      reason: "用途相同",
    });
    expect(conversationHistory(state)).toEqual([
      { role: "user", content: "分两级" },
      { role: "assistant", content: "已归入开发" },
    ]);
    expect(before[0]!.folderPath).toEqual([]);
    const snapshot = workspaceSnapshotSchema.parse({
      version: 1,
      filename: "a.html",
      title: "A",
      bookmarks,
      original: before,
      results: {},
      report: "",
      traceUrl: "",
      task: null,
      conversation: state,
    });
    expect(snapshot.conversation.turns[0]!.result!.bookmarks[0]!.folderPath).toEqual(["开发"]);
    expect(recoverConversation(initial).turns[0]).toMatchObject({
      status: "error",
      error: "上次任务已中断，请重新发送要求。",
    });
  });
  it("keeps the current workspace untouched on failed or cancelled rounds", () => {
    for (const event of [
      { type: "error" as const, requestId: "round1", message: "失败" },
      { type: "cancelled" as const, requestId: "round1" },
    ]) {
      const state = receiveConversationEvent(initial, event);
      expect(state.turns[0]!.result).toBeUndefined();
      expect(state.turns[0]!.before).toEqual(before);
      expect(state.turns[0]!.status).toBe(event.type);
    }
  });
});
