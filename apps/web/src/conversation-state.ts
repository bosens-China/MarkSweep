import { z } from "zod";
import { bookmarksSchema, type TaskEvent } from "@marksweep/core/protocol";
import { activitySchema, organizationSchema, type AgentActivity } from "@marksweep/core/conversation/schema";

export const conversationTurnSchema = z.object({
  requestId: z.string(),
  instruction: z.string(),
  before: bookmarksSchema,
  status: z.enum(["running", "complete", "error", "cancelled"]),
  error: z.string().optional(),
  lastSequence: z.number().default(0),
  activities: z.array(activitySchema),
  result: z.object({ bookmarks: bookmarksSchema, organization: organizationSchema }).optional(),
});
export const conversationStateSchema = z.object({
  id: z.string(),
  turns: z.array(conversationTurnSchema),
});
export type ConversationState = z.infer<typeof conversationStateSchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export function mergeActivity(activities: AgentActivity[], activity: AgentActivity): AgentActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...activities, activity];
  return activities.map((previous, i) =>
    i !== index
      ? previous
      : previous.kind === "message" && activity.kind === "message"
        ? { ...activity, text: previous.text + activity.text }
        : activity,
  );
}

export function receiveConversationEvent(state: ConversationState, event: TaskEvent): ConversationState {
  return {
    ...state,
    turns: state.turns.map((turn) => {
      if (turn.requestId !== event.requestId || turn.status !== "running") return turn;
      if (event.type === "activity") {
        if (event.sequence <= turn.lastSequence) return turn;
        return { ...turn, lastSequence: event.sequence, activities: mergeActivity(turn.activities, event.activity) };
      }
      if (event.type === "complete" && event.bookmarks && event.organization)
        return {
          ...turn,
          status: "complete",
          result: { bookmarks: event.bookmarks, organization: event.organization },
        };
      if (event.type === "error" || event.type === "cancelled")
        return {
          ...turn,
          status: event.type,
          error: event.type === "error" ? event.message : "已取消，本轮未应用更改。",
          activities: stopActivities(turn.activities),
        };
      return turn;
    }),
  };
}

function stopActivities(activities: AgentActivity[]): AgentActivity[] {
  return activities.map((activity) =>
    (activity.kind === "tool" || activity.kind === "timing") && activity.status === "running"
      ? { ...activity, status: "error", text: "执行已中断" }
      : activity,
  );
}

export function recoverConversation(state: ConversationState): ConversationState {
  return {
    ...state,
    id: state.id || crypto.randomUUID(),
    turns: state.turns.map((turn) =>
      turn.status === "running"
        ? {
            ...turn,
            status: "error",
            error: "上次任务已中断，请重新发送要求。",
            activities: stopActivities(turn.activities),
          }
        : turn,
    ),
  };
}

export function conversationHistory(state: ConversationState) {
  // shortcut: 请求最多带最近 40 轮，超出时保留首轮要求；需要更长历史时改为持久化摘要。
  const completed = state.turns.filter((turn) => turn.status === "complete" && turn.result);
  const retained = completed.length > 40 ? [completed[0]!, ...completed.slice(-39)] : completed;
  return retained.flatMap((turn) => [
    { role: "user" as const, content: turn.instruction || "按用途整理书签。" },
    { role: "assistant" as const, content: turn.result!.organization.summary },
  ]);
}

export function bookmarkChanges(turn: ConversationTurn) {
  const before = new Map(turn.before.map((bookmark) => [bookmark.id, bookmark]));
  const reasons = new Map(turn.result?.organization.assignments.map((item) => [item.id, item.reason]));
  return (turn.result?.bookmarks ?? []).flatMap((bookmark) => {
    const original = before.get(bookmark.id);
    if (
      !original ||
      (original.title === bookmark.title && JSON.stringify(original.folderPath) === JSON.stringify(bookmark.folderPath))
    )
      return [];
    return [{ id: bookmark.id, before: original, after: bookmark, reason: reasons.get(bookmark.id) ?? "" }];
  });
}
