import { ChatOpenAI } from "@langchain/openai";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import { createBookmarkHtmlDocument, type BookmarkHtmlDocument } from "../writer/bookmark-html.js";
import type { AiConfig } from "../cli/config.js";
import { scoreTitle } from "../bookmarks/dedupe.js";
import { normalizeBookmarkUrl } from "../bookmarks/url.js";
import { BookmarkClassificationSchema, type BookmarkClassification, type ClassifiedFolder } from "./types.js";
import { createFetchWebPageTool, type WebPageFetcherOptions } from "./tools/web-page-fetcher.js";

interface RunnableLike {
  invoke(input: unknown): Promise<unknown>;
}

interface ToolLike {
  name: string;
  invoke(input: unknown): Promise<unknown>;
}

export interface ToolCallingModelLike {
  invoke(input: unknown): Promise<unknown>;
  bindTools?: (tools: Parameters<ChatOpenAI["bindTools"]>[0], options?: Record<string, unknown>) => RunnableLike;
}

export interface ClassifyBookmarksOptions {
  lang?: string;
  fetcherOptions?: WebPageFetcherOptions;
  maxToolCalls?: number;
  callbacks?: Callbacks;
}

interface BookmarkContext {
  url: string;
  content: string;
}

export async function classifyBookmarks(
  bookmarks: ExtractedBookmark[],
  aiConfig: AiConfig,
  options: ClassifyBookmarksOptions = {},
): Promise<BookmarkHtmlDocument> {
  const model = new ChatOpenAI({
    apiKey: aiConfig.apiKey,
    model: aiConfig.model,
    temperature: 0,
    callbacks: options.callbacks,
    configuration: {
      baseURL: aiConfig.baseUrl,
    },
  });

  return classifyBookmarksWithModel(bookmarks, model, {
    ...options,
    lang: options.lang ?? aiConfig.lang,
  });
}

export async function classifyBookmarksWithModel(
  bookmarks: ExtractedBookmark[],
  model: ToolCallingModelLike,
  options: ClassifyBookmarksOptions = {},
): Promise<BookmarkHtmlDocument> {
  const lang = options.lang ?? "zh";
  const fetchTool = createFetchWebPageTool(options.fetcherOptions);
  const contexts = await collectModelRequestedContexts(bookmarks, model, fetchTool, options.maxToolCalls ?? 8);
  const rawResult = await model.invoke([
    ["system", createClassificationSystemPrompt(lang)],
    ["human", createClassificationUserPrompt(bookmarks, contexts)],
  ]);
  const classification = parseClassificationResult(rawResult);

  validateClassification(bookmarks, classification);
  return classificationToHtmlDocument(bookmarks, classification);
}

export function parseClassificationResult(value: unknown): BookmarkClassification {
  const direct = BookmarkClassificationSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const text = getTextContent(value);
  if (!text) {
    throw new Error("AI 分类结果不是有效 JSON。");
  }

  try {
    return BookmarkClassificationSchema.parse(JSON.parse(extractJsonText(text)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI 分类结果不是有效 JSON：${message}`, { cause: error });
  }
}

export function classificationToHtmlDocument(
  bookmarks: ExtractedBookmark[],
  classification: BookmarkClassification,
): BookmarkHtmlDocument {
  validateClassification(bookmarks, classification);

  const bookmarkByUrl = createBookmarkUrlIndex(bookmarks);
  const assigned: ExtractedBookmark[] = [];

  for (const folder of classification.folders) {
    collectClassifiedBookmarks(folder, [], bookmarkByUrl, assigned);
  }

  return createBookmarkHtmlDocument(assigned, { title: "Bookmarks" });
}

export function validateClassification(bookmarks: ExtractedBookmark[], classification: BookmarkClassification): void {
  const bookmarkByUrl = createBookmarkUrlIndex(bookmarks);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unknown = new Set<string>();

  for (const url of collectClassificationUrls(classification.folders)) {
    const bookmark = findBookmarkByUrl(bookmarkByUrl, url);
    const key = bookmark ? normalizeBookmarkUrl(bookmark.url) : normalizeBookmarkUrl(url);

    if (seen.has(key)) {
      duplicates.add(url);
    }

    if (!bookmark) {
      unknown.add(url);
    }

    seen.add(key);
  }

  const missing = bookmarks
    .filter((bookmark) => !seen.has(normalizeBookmarkUrl(bookmark.url)))
    .map((bookmark) => bookmark.url);

  if (duplicates.size > 0 || unknown.size > 0 || missing.length > 0) {
    const parts = [
      duplicates.size > 0 ? `重复 URL：${[...duplicates].join(", ")}` : undefined,
      unknown.size > 0 ? `未知 URL：${[...unknown].join(", ")}` : undefined,
      missing.length > 0 ? `缺失 URL：${missing.join(", ")}` : undefined,
    ].filter(Boolean);

    throw new Error(`AI 分类结果不完整：${parts.join("；")}`);
  }
}

async function collectModelRequestedContexts(
  bookmarks: ExtractedBookmark[],
  model: ToolCallingModelLike,
  fetchTool: ToolLike,
  maxToolCalls: number,
): Promise<BookmarkContext[]> {
  if (!model.bindTools || maxToolCalls <= 0) {
    return [];
  }

  const candidates = bookmarks.filter(shouldAskModelAboutBookmark).slice(0, maxToolCalls * 2);
  if (candidates.length === 0) {
    return [];
  }

  const toolModel = model.bindTools([fetchTool] as Parameters<ChatOpenAI["bindTools"]>[0], {
    tool_choice: "auto",
    parallel_tool_calls: false,
  });
  const toolDecision = await toolModel.invoke([
    [
      "system",
      "You decide whether extra webpage content is needed before bookmark classification. Call fetch_web_page only for vague titles. Do not fetch pages whose title and URL are already clear.",
    ],
    ["human", JSON.stringify(candidates.map(toPromptBookmark), null, 2)],
  ]);
  const calls = getToolCalls(toolDecision)
    .filter((call) => call.name === fetchTool.name)
    .slice(0, maxToolCalls);
  const contexts: BookmarkContext[] = [];

  for (const call of calls) {
    const url = typeof call.args.url === "string" ? call.args.url : undefined;
    const bookmark = url ? bookmarks.find((candidate) => candidate.url === url) : undefined;

    if (!url || !bookmark) {
      continue;
    }

    let output: unknown;
    try {
      output = await fetchTool.invoke({ url });
    } catch {
      // 单个网页抓取失败不应中断整批分类。
      continue;
    }

    contexts.push({
      url,
      content: typeof output === "string" ? output : JSON.stringify(output),
    });
  }

  return contexts;
}

function shouldAskModelAboutBookmark(bookmark: ExtractedBookmark): boolean {
  if (!bookmark.isWebUrl) {
    return false;
  }

  const host = getHostname(bookmark.url);
  const normalizedTitle = bookmark.title.trim().toLowerCase();

  return (
    scoreTitle(bookmark.title) < 8 || (host ? normalizedTitle === host || normalizedTitle === `www.${host}` : false)
  );
}

function createClassificationSystemPrompt(lang: string): string {
  return [
    "You are MarkSweep, a bookmark organization agent.",
    `Create folder names in this language: ${lang}.`,
    "Return only valid JSON. Do not wrap it in Markdown.",
    "Generate a practical multi-level folder tree. Depth is unrestricted, but avoid over-fragmentation and keep top-level folder count moderate.",
    "Every bookmark URL must appear exactly once in folders[].bookmarks.",
    "Do not preserve the original folder structure.",
    "If a bookmark is unclear or low-confidence, put it under a folder named 其他 for Chinese output, or Other for non-Chinese output.",
  ].join("\n");
}

function createClassificationUserPrompt(bookmarks: ExtractedBookmark[], contexts: BookmarkContext[]): string {
  return JSON.stringify(
    {
      bookmarks: bookmarks.map(toPromptBookmark),
      fetched_contexts: contexts,
      output_shape: {
        folders: [
          {
            title: "folder name",
            bookmarks: ["bookmark url"],
            children: [],
          },
        ],
      },
    },
    null,
    2,
  );
}

function getTextContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as { content?: unknown; text?: unknown };
  if (typeof candidate.content === "string") {
    return candidate.content;
  }

  if (Array.isArray(candidate.content)) {
    return candidate.content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : undefined,
      )
      .filter((part): part is string => Boolean(part))
      .join("\n");
  }

  return typeof candidate.text === "string" ? candidate.text : undefined;
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
}

function toPromptBookmark(bookmark: ExtractedBookmark): {
  title: string;
  url: string;
} {
  return {
    title: bookmark.title,
    url: bookmark.url,
  };
}

function collectClassifiedBookmarks(
  folder: ClassifiedFolder,
  parentPath: string[],
  bookmarkByUrl: Map<string, ExtractedBookmark>,
  assigned: ExtractedBookmark[],
): void {
  const path = [...parentPath, folder.title];

  for (const url of folder.bookmarks) {
    const bookmark = findBookmarkByUrl(bookmarkByUrl, url);
    if (bookmark) {
      assigned.push({
        ...bookmark,
        folderPath: path,
      });
    }
  }

  for (const child of folder.children) {
    collectClassifiedBookmarks(child, path, bookmarkByUrl, assigned);
  }
}

function collectClassificationUrls(folders: ClassifiedFolder[]): string[] {
  const urls: string[] = [];

  for (const folder of folders) {
    urls.push(...folder.bookmarks);
    urls.push(...collectClassificationUrls(folder.children));
  }

  return urls;
}

function createBookmarkUrlIndex(bookmarks: ExtractedBookmark[]): Map<string, ExtractedBookmark> {
  const index = new Map<string, ExtractedBookmark>();

  for (const bookmark of bookmarks) {
    index.set(bookmark.url, bookmark);
    index.set(normalizeBookmarkUrl(bookmark.url), bookmark);
  }

  return index;
}

function findBookmarkByUrl(index: Map<string, ExtractedBookmark>, url: string): ExtractedBookmark | undefined {
  return index.get(url) ?? index.get(normalizeBookmarkUrl(url));
}

function getToolCalls(value: unknown): Array<{ name: string; args: Record<string, unknown> }> {
  if (!value || typeof value !== "object") {
    return [];
  }

  const calls = (value as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) {
    return [];
  }

  return calls
    .map((call) => {
      if (!call || typeof call !== "object") {
        return undefined;
      }

      const candidate = call as { name?: unknown; args?: unknown };
      return typeof candidate.name === "string" && candidate.args && typeof candidate.args === "object"
        ? { name: candidate.name, args: candidate.args as Record<string, unknown> }
        : undefined;
    })
    .filter((call): call is { name: string; args: Record<string, unknown> } => Boolean(call));
}

function getHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}
