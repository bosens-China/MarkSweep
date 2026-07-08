import * as cheerio from "cheerio";
import { fetch as undiciFetch } from "undici";
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export type WebPageFetchSource = "firecrawl" | "jina" | "html";

export interface WebPageContent {
  url: string;
  title?: string;
  description?: string;
  content: string;
  source: WebPageFetchSource;
}

export interface WebPageFetcherOptions {
  firecrawlApiKey?: string;
  firecrawlBaseUrl?: string;
  jinaApiKey?: string;
  maxChars?: number;
  timeoutMs?: number;
  fetcher?: typeof undiciFetch;
}

const defaultMaxChars = 6000;
const defaultTimeoutMs = 10000;
const defaultFirecrawlBaseUrl = "https://api.firecrawl.dev/v2";

export async function fetchWebPageContent(url: string, options: WebPageFetcherOptions = {}): Promise<WebPageContent> {
  const maxChars = options.maxChars ?? defaultMaxChars;
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const fetcher = options.fetcher ?? undiciFetch;
  const errors: string[] = [];

  if (options.firecrawlApiKey) {
    try {
      return await fetchWithFirecrawl(url, {
        apiKey: options.firecrawlApiKey,
        baseUrl: options.firecrawlBaseUrl ?? defaultFirecrawlBaseUrl,
        maxChars,
        timeoutMs,
        fetcher,
      });
    } catch (error) {
      errors.push(`firecrawl: ${getErrorMessage(error)}`);
    }
  }

  try {
    return await fetchWithJina(url, {
      apiKey: options.jinaApiKey,
      maxChars,
      timeoutMs,
      fetcher,
    });
  } catch (error) {
    errors.push(`jina: ${getErrorMessage(error)}`);
  }

  try {
    return await fetchWithPlainHtml(url, { maxChars, timeoutMs, fetcher });
  } catch (error) {
    errors.push(`html: ${getErrorMessage(error)}`);
  }

  throw new Error(`网页抓取失败：${errors.join("; ")}`);
}

export function createFetchWebPageTool(options: WebPageFetcherOptions = {}) {
  return tool(
    async ({ url }) => {
      const result = await fetchWebPageContent(url, options);
      return JSON.stringify(result);
    },
    {
      name: "fetch_web_page",
      description:
        "Fetches a bookmark page and returns LLM-friendly title, description, and content. Use only when the bookmark title is too vague to classify from title and URL.",
      schema: z.object({
        url: z.string().url().describe("The bookmark URL to fetch."),
      }),
    },
  );
}

async function fetchWithFirecrawl(
  url: string,
  options: {
    apiKey: string;
    baseUrl: string;
    maxChars: number;
    timeoutMs: number;
    fetcher: typeof undiciFetch;
  },
): Promise<WebPageContent> {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/scrape`;
  const response = await fetchWithTimeout(
    options.fetcher,
    endpoint,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    },
    options.timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      markdown?: string;
      metadata?: {
        title?: string;
        description?: string;
      };
    };
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
    };
  };
  const content = payload.data?.markdown ?? payload.markdown ?? "";

  if (!content.trim()) {
    throw new Error("empty content");
  }

  return {
    url,
    title: payload.data?.metadata?.title ?? payload.metadata?.title,
    description: payload.data?.metadata?.description ?? payload.metadata?.description,
    content: truncate(content, options.maxChars),
    source: "firecrawl",
  };
}

async function fetchWithJina(
  url: string,
  options: {
    apiKey?: string;
    maxChars: number;
    timeoutMs: number;
    fetcher: typeof undiciFetch;
  },
): Promise<WebPageContent> {
  const response = await fetchWithTimeout(
    options.fetcher,
    `https://r.jina.ai/${url}`,
    {
      headers: {
        accept: "text/plain",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
    },
    options.timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error("empty content");
  }

  return {
    url,
    title: readJinaHeader(text, "Title"),
    description: readJinaHeader(text, "Description"),
    content: truncate(text, options.maxChars),
    source: "jina",
  };
}

async function fetchWithPlainHtml(
  url: string,
  options: {
    maxChars: number;
    timeoutMs: number;
    fetcher: typeof undiciFetch;
  },
): Promise<WebPageContent> {
  const response = await fetchWithTimeout(
    options.fetcher,
    url,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "MarkSweep/0.1",
      },
    },
    options.timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();

  const title = $("title").first().text().trim() || undefined;
  const description = $('meta[name="description"]').attr("content")?.trim();
  const content = $("body").text().replace(/\s+/g, " ").trim();

  if (!content) {
    throw new Error("empty content");
  }

  return {
    url,
    title,
    description,
    content: truncate(content, options.maxChars),
    source: "html",
  };
}

function readJinaHeader(text: string, name: string): string | undefined {
  const line = text.split(/\r?\n/).find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}:`));

  return line?.slice(name.length + 1).trim() || undefined;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function normalizeTimeoutMs(value: number | undefined): number {
  return value && Number.isFinite(value) && value > 0 ? value : defaultTimeoutMs;
}

async function fetchWithTimeout(
  fetcher: typeof undiciFetch,
  input: Parameters<typeof undiciFetch>[0],
  init: Parameters<typeof undiciFetch>[1],
  timeoutMs: number,
): ReturnType<typeof undiciFetch> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetcher(input, { ...(init ?? {}), signal: controller.signal }), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
