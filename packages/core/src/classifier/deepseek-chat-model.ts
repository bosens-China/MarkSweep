import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { BaseLanguageModelInput, ToolDefinition } from "@langchain/core/language_models/base";
import { fetch as undiciFetch } from "undici";

interface DeepSeekCallOptions extends BaseChatModelCallOptions {
  tools?: ToolDefinition[];
}

interface DeepSeekChatModelFields extends BaseChatModelParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetcher?: typeof undiciFetch;
}

interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: DeepSeekToolCall[];
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
  model?: string;
}

export class DeepSeekChatModel extends BaseChatModel<DeepSeekCallOptions> {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof undiciFetch;

  constructor(fields: DeepSeekChatModelFields) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.baseUrl = fields.baseUrl;
    this.model = fields.model;
    this.fetcher = fields.fetcher ?? undiciFetch;
  }

  _llmType(): string {
    return "deepseek-compatible";
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs: Partial<DeepSeekCallOptions> = {},
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, DeepSeekCallOptions> {
    const supportedOptions = { ...kwargs };
    delete supportedOptions.tool_choice;
    return this.withConfig({
      ...supportedOptions,
      tools: tools.map((item) => convertToOpenAITool(item)),
    });
  }

  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]): Promise<ChatResult> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toDeepSeekMessage),
        ...(options.tools?.length ? { tools: options.tools } : {}),
      }),
      signal: options.signal,
    });
    const payload = (await response.json()) as DeepSeekResponse;
    if (!response.ok) throw new Error(`${response.status} ${payload.error?.message ?? "DeepSeek 请求失败"}`);

    const choice = payload.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error("DeepSeek 没有返回消息。");

    const toolCalls = (message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      args: parseToolArguments(call.function.arguments),
      type: "tool_call" as const,
    }));
    const content = message.content ?? "";
    const aiMessage = new AIMessage({
      content,
      tool_calls: toolCalls,
      additional_kwargs: {
        ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
        ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      },
      response_metadata: {
        model_provider: "deepseek",
        model_name: payload.model ?? this.model,
        finish_reason: choice.finish_reason,
      },
    });

    return { generations: [{ message: aiMessage, text: content }] };
  }
}

function toDeepSeekMessage(message: BaseMessage): Record<string, unknown> {
  const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  if (SystemMessage.isInstance(message)) return { role: "system", content };
  if (HumanMessage.isInstance(message)) return { role: "user", content };
  if (ToolMessage.isInstance(message)) {
    return { role: "tool", tool_call_id: message.tool_call_id, content };
  }
  if (AIMessage.isInstance(message)) {
    const rawToolCalls = message.additional_kwargs.tool_calls;
    return {
      role: "assistant",
      content,
      ...(typeof message.additional_kwargs.reasoning_content === "string"
        ? { reasoning_content: message.additional_kwargs.reasoning_content }
        : {}),
      ...(Array.isArray(rawToolCalls) && rawToolCalls.length > 0 ? { tool_calls: rawToolCalls } : {}),
    };
  }
  throw new Error(`DeepSeek 不支持消息类型：${message.getType()}`);
}

function parseToolArguments(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DeepSeek 工具参数不是 JSON 对象。");
  }
  return parsed as Record<string, unknown>;
}
