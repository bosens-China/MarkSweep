import { useState } from "react";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";
import type { TaskEvent } from "@marksweep/core/protocol";
import {
  conversationHistory,
  receiveConversationEvent,
  recoverConversation,
  type ConversationState,
} from "./conversation-state";

export function useConversation() {
  const [state, setState] = useState<ConversationState>(() => ({ id: crypto.randomUUID(), turns: [] }));
  function begin(requestId: string, bookmarks: ExtractedBookmark[], instruction: string) {
    const history = conversationHistory(state);
    setState((previous) => ({
      ...previous,
      turns: [
        ...previous.turns,
        {
          requestId,
          instruction,
          before: bookmarks,
          status: "running",
          activities: [],
          lastSequence: 0,
        },
      ],
    }));
    return { id: state.id, instruction, history };
  }
  function receive(event: TaskEvent) {
    setState((previous) => receiveConversationEvent(previous, event));
  }
  function reset() {
    setState({ id: crypto.randomUUID(), turns: [] });
  }
  return { state, begin, receive, reset, restore: (saved: ConversationState) => setState(recoverConversation(saved)) };
}
