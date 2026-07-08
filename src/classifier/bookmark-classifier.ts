import { ChatOpenAI } from "@langchain/openai";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import { createBookmarkHtmlDocument, type BookmarkHtmlDocument } from "../writer/bookmark-html.js";
import type { AiConfig } from "../cli/config.js";
import { scoreTitle } from "../bookmarks/dedupe.js";
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
  bindTools?: (tools: Parameters<ChatOpenAI["bindTools"]>[0], options?: Record<string, unknown>) => RunnableLike;
  withStructuredOutput: (
    schema: Parameters<ChatOpenAI["withStructuredOutput"]>[0],
    options?: Record<string, unknown>,
  ) => RunnableLike;
}

export interface ClassifyBookmarksOptions {
  lang?: string;
  fetcherOptions?: WebPageFetcherOptions;
  maxToolCalls?: number;
  callbacks?: Callbacks;
}

interface BookmarkContext {
  id: string;
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
  const structuredModel = model.withStructuredOutput(BookmarkClassificationSchema, {
    name: "bookmark_classification",
  });
  const rawResult = await structuredModel.invoke([
    ["system", createClassificationSystemPrompt(lang)],
    ["human", createClassificationUserPrompt(bookmarks, contexts)],
  ]);
  const classification = BookmarkClassificationSchema.parse(rawResult);

  validateClassification(bookmarks, classification);
  return classificationToHtmlDocument(bookmarks, classification);
}

export function classificationToHtmlDocument(
  bookmarks: ExtractedBookmark[],
  classification: BookmarkClassification,
): BookmarkHtmlDocument {
  validateClassification(bookmarks, classification);

  const bookmarkById = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const assigned: ExtractedBookmark[] = [];

  for (const folder of classification.folders) {
    collectClassifiedBookmarks(folder, [], bookmarkById, assigned);
  }

  return createBookmarkHtmlDocument(assigned, { title: "Bookmarks" });
}

export function validateClassification(bookmarks: ExtractedBookmark[], classification: BookmarkClassification): void {
  const expectedIds = new Set(bookmarks.map((bookmark) => bookmark.id));
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unknown = new Set<string>();

  for (const id of collectClassificationIds(classification.folders)) {
    if (seen.has(id)) {
      duplicates.add(id);
    }

    if (!expectedIds.has(id)) {
      unknown.add(id);
    }

    seen.add(id);
  }

  const missing = [...expectedIds].filter((id) => !seen.has(id));

  if (duplicates.size > 0 || unknown.size > 0 || missing.length > 0) {
    const parts = [
      duplicates.size > 0 ? `重复 ID：${[...duplicates].join(", ")}` : undefined,
      unknown.size > 0 ? `未知 ID：${[...unknown].join(", ")}` : undefined,
      missing.length > 0 ? `缺失 ID：${missing.join(", ")}` : undefined,
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
      id: bookmark.id,
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
    "Generate a practical multi-level folder tree. Depth is unrestricted, but avoid over-fragmentation and keep top-level folder count moderate.",
    "Every bookmark ID must appear exactly once.",
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
            bookmarks: ["bookmark id"],
            children: [],
          },
        ],
      },
    },
    null,
    2,
  );
}

function toPromptBookmark(bookmark: ExtractedBookmark): {
  id: string;
  title: string;
  url: string;
} {
  return {
    id: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
  };
}

function collectClassifiedBookmarks(
  folder: ClassifiedFolder,
  parentPath: string[],
  bookmarkById: Map<string, ExtractedBookmark>,
  assigned: ExtractedBookmark[],
): void {
  const path = [...parentPath, folder.title];

  for (const id of folder.bookmarks) {
    const bookmark = bookmarkById.get(id);
    if (bookmark) {
      assigned.push({
        ...bookmark,
        folderPath: path,
      });
    }
  }

  for (const child of folder.children) {
    collectClassifiedBookmarks(child, path, bookmarkById, assigned);
  }
}

function collectClassificationIds(folders: ClassifiedFolder[]): string[] {
  const ids: string[] = [];

  for (const folder of folders) {
    ids.push(...folder.bookmarks);
    ids.push(...collectClassificationIds(folder.children));
  }

  return ids;
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
