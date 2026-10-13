import { z } from "zod";
import type { BookmarkCheckResult, BookmarkCheckSummary } from "./checker/types.js";
import type { ExtractedBookmark } from "./parser/bookmark-html.js";
import { conversationInputSchema, type AgentActivity, type Organization } from "./conversation/schema.js";

export const bookmarkSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(10000),
  url: z.string().max(20000),
  folderPath: z.array(z.string().max(1000)).max(100),
  attributes: z.record(z.string(), z.string()),
  isWebUrl: z.boolean(),
});

export const bookmarksSchema = z
  .array(bookmarkSchema)
  .max(50000)
  .refine(
    (bookmarks) => new Set(bookmarks.map((bookmark) => bookmark.id)).size === bookmarks.length,
    "书签 ID 不能重复。",
  );

export const checkResultSchema: z.ZodType<BookmarkCheckResult> = z.object({
  bookmark: bookmarkSchema,
  status: z.enum(["valid", "broken", "suspicious", "skipped"]),
  reason: z.enum([
    "ok",
    "redirect",
    "not_found",
    "gone",
    "dns_not_found",
    "connection_refused",
    "empty_response",
    "timeout",
    "auth_required",
    "forbidden",
    "rate_limited",
    "ssl_error",
    "server_error",
    "http_error",
    "network_error",
    "non_web_url",
    "https_upgrade",
    "protocol_error",
  ]),
  attempts: z.number().int().nonnegative(),
  method: z.enum(["HEAD", "GET"]).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  error: z.string().optional(),
});

export const aiOptionsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .refine((value) => !value || (URL.canParse(value) && /^https?:\/\//i.test(value)), "请输入 HTTP(S) API 地址。")
    .optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(2000).optional(),
  lang: z.string().max(100).optional(),
  compatibility: z.enum(["auto", "openai", "deepseek"]).optional(),
});

export const taskRequestSchema = z
  .object({
    type: z.literal("run"),
    requestId: z.string().min(1).max(100),
    task: z.enum(["check", "classify", "audit", "organize"]),
    conversation: conversationInputSchema.optional(),
    bookmarks: bookmarksSchema,
    ai: aiOptionsSchema.default({}),
    options: z
      .object({
        concurrency: z.number().int().min(1).max(100).default(20),
        timeout: z.number().int().min(100).max(120000).default(10000),
        retries: z.number().int().min(0).max(5).default(2),
        maxPages: z.number().int().min(0).max(100).default(20),
        aiTimeout: z.number().int().min(60000).max(1800000).optional(),
        langsmith: z.boolean().optional(),
      })
      .default({ concurrency: 20, timeout: 10000, retries: 2, maxPages: 20 }),
  })
  .refine((request) => request.task !== "organize" || Boolean(request.conversation), "整理任务需要对话参数。");

export const clientMessageSchema = z.discriminatedUnion("type", [
  taskRequestSchema,
  z.object({ type: z.literal("cancel"), requestId: z.string().min(1).max(100) }),
]);

export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type AiOptions = z.infer<typeof aiOptionsSchema>;
export type TaskEvent = { requestId: string } & (
  | { type: "progress"; message: string; completed?: number; total?: number }
  | { type: "check"; result: BookmarkCheckResult }
  | { type: "token"; token: string }
  | { type: "activity"; sequence: number; activity: AgentActivity }
  | { type: "trace"; url: string }
  | { type: "warning"; message: string }
  | {
      type: "complete";
      bookmarks?: ExtractedBookmark[];
      report?: string;
      summary?: BookmarkCheckSummary;
      organization?: Organization;
    }
  | { type: "cancelled" }
  | { type: "error"; message: string }
);

export interface PublicConfig {
  ai: AiOptions;
  hasApiKey: boolean;
  langsmith: boolean;
  configPath: string;
}

export interface ImportedBookmarks {
  rootTitle: string;
  bookmarks: ExtractedBookmark[];
}
