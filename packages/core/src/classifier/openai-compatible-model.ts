import { ChatOpenAICompletions, type OpenAIClient, type OpenAICoreRequestOptions } from "@langchain/openai";
import { isAIMessage, type BaseMessage } from "@langchain/core/messages";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

type StreamingRequest = OpenAIClient.Chat.ChatCompletionCreateParamsStreaming;
type CompleteRequest = OpenAIClient.Chat.ChatCompletionCreateParamsNonStreaming;
type Chunk = OpenAIClient.Chat.ChatCompletionChunk;
type Completion = OpenAIClient.Chat.ChatCompletion;

// SDK 已保留收到的 reasoning_content，但序列化下一轮时会丢弃；兼容要求回传该字段的服务。
export class OpenAICompatibleChatModel extends ChatOpenAICompletions {
  private readonly reasoningByCall = new Map<string, string>();

  private rememberReasoning(messages: BaseMessage[]) {
    this.reasoningByCall.clear();
    for (const message of messages) {
      if (!isAIMessage(message)) continue;
      const reasoning = message.additional_kwargs.reasoning_content;
      if (typeof reasoning !== "string") continue;
      for (const call of message.tool_calls ?? []) if (call.id) this.reasoningByCall.set(call.id, reasoning);
    }
  }

  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"], manager?: CallbackManagerForLLMRun) {
    this.rememberReasoning(messages);
    return super._generate(messages, options, manager);
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    manager?: CallbackManagerForLLMRun,
  ) {
    this.rememberReasoning(messages);
    yield* super._streamResponseChunks(messages, options, manager);
  }

  async *_streamChatModelEvents(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    manager?: CallbackManagerForLLMRun,
  ) {
    this.rememberReasoning(messages);
    yield* super._streamChatModelEvents(messages, options, manager);
  }

  completionWithRetry(request: StreamingRequest, options?: OpenAICoreRequestOptions): Promise<AsyncIterable<Chunk>>;
  completionWithRetry(request: CompleteRequest, options?: OpenAICoreRequestOptions): Promise<Completion>;
  completionWithRetry(
    request: StreamingRequest | CompleteRequest,
    options?: OpenAICoreRequestOptions,
  ): Promise<AsyncIterable<Chunk> | Completion> {
    const messages = request.messages.map((message) => {
      if (message.role !== "assistant") return message;
      const reasoning = message.tool_calls
        ?.map((call) => this.reasoningByCall.get(call.id))
        .find((value) => value !== undefined);
      return reasoning === undefined ? message : { ...message, reasoning_content: reasoning };
    });
    return request.stream
      ? super.completionWithRetry({ ...request, messages, stream: true }, options)
      : super.completionWithRetry({ ...request, messages, stream: false }, options);
  }
}
