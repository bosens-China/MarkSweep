import { fetch as undiciFetch } from "undici";
import pLimit from "p-limit";
export { summarizeCheckResults } from "./summary.js";
import { classifyHttpStatus, classifyRequestError } from "./result-classifier.js";
import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import type { BookmarkCheckResult } from "./types.js";

export interface CheckBookmarksOptions {
  concurrency: number;
  timeout: number;
  retries: number;
}

export interface CheckBookmarksProgress {
  bookmark: ExtractedBookmark;
  result: BookmarkCheckResult;
  index: number;
  completed: number;
  total: number;
}

export interface FetchLikeResponse {
  status: number;
  url?: string;
  body?: {
    cancel?: () => Promise<void> | void;
  } | null;
}

export type FetchLike = (
  url: string,
  init: {
    method: "HEAD" | "GET";
    signal: AbortSignal;
    redirect: "follow";
    headers: Record<string, string>;
  },
) => Promise<FetchLikeResponse>;

export interface CheckBookmarksContext {
  signal?: AbortSignal;
  fetcher?: FetchLike;
  onProgress?: (progress: CheckBookmarksProgress) => void;
}

const defaultHeaders = {
  "user-agent": "MarkSweep/0.1 (+https://www.npmjs.com/package/@boses/marksweep)",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export async function checkBookmarks(
  bookmarks: ExtractedBookmark[],
  options: CheckBookmarksOptions,
  context: CheckBookmarksContext = {},
): Promise<BookmarkCheckResult[]> {
  const limit = pLimit(options.concurrency);
  const fetcher = context.fetcher ?? undiciFetch;
  let completed = 0;

  return Promise.all(
    bookmarks.map((bookmark, index) =>
      limit(async () => {
        const result = await checkBookmark(bookmark, options, fetcher, context.signal);
        completed += 1;
        context.onProgress?.({
          bookmark,
          result,
          index,
          completed,
          total: bookmarks.length,
        });
        return result;
      }),
    ),
  );
}

export async function checkBookmark(
  bookmark: ExtractedBookmark,
  options: CheckBookmarksOptions,
  fetcher: FetchLike = undiciFetch,
  signal?: AbortSignal,
): Promise<BookmarkCheckResult> {
  signal?.throwIfAborted();
  const result = await checkBookmarkUrl(bookmark, options, fetcher, signal);
  const httpsBookmark = createHttpsBookmark(bookmark);

  if (result.status === "valid" || !httpsBookmark) {
    return result;
  }

  const httpsResult = await checkBookmarkUrl(httpsBookmark, options, fetcher, signal);

  if (httpsResult.status !== "valid") {
    return result;
  }

  return {
    ...httpsResult,
    reason: "https_upgrade",
  };
}

async function checkBookmarkUrl(
  bookmark: ExtractedBookmark,
  options: CheckBookmarksOptions,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<BookmarkCheckResult> {
  if (!bookmark.isWebUrl) {
    return {
      bookmark,
      status: "skipped",
      reason: "non_web_url",
      attempts: 0,
    };
  }

  const maxAttempts = options.retries + 1;
  let lastResult: BookmarkCheckResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const headResult = await requestAndClassify(bookmark, "HEAD", attempt, options.timeout, fetcher, signal);

    if (headResult.status === "valid") {
      return headResult;
    }

    lastResult = await requestAndClassify(bookmark, "GET", attempt, options.timeout, fetcher, signal);

    if (lastResult.status === "valid" || !isRetryable(lastResult)) {
      return lastResult;
    }
  }

  const fallbackResult =
    lastResult ??
    ({
      bookmark,
      status: "suspicious",
      reason: "network_error",
      attempts: maxAttempts,
      error: "No request result was produced.",
    } satisfies BookmarkCheckResult);

  if (fallbackResult.reason !== "timeout") {
    return fallbackResult;
  }

  return confirmTimeoutResult(bookmark, options, maxAttempts + 1, fetcher, signal);
}

function createHttpsBookmark(bookmark: ExtractedBookmark): ExtractedBookmark | undefined {
  let url: URL;

  try {
    url = new URL(bookmark.url);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:") {
    return undefined;
  }

  url.protocol = "https:";

  return {
    ...bookmark,
    url: url.toString(),
    attributes: {
      ...bookmark.attributes,
      href: url.toString(),
    },
  };
}

async function confirmTimeoutResult(
  bookmark: ExtractedBookmark,
  options: CheckBookmarksOptions,
  attempt: number,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<BookmarkCheckResult> {
  const result = await requestAndClassify(
    bookmark,
    "GET",
    attempt,
    getTimeoutConfirmationMs(options.timeout),
    fetcher,
    signal,
  );

  if (result.reason !== "timeout") {
    return result;
  }

  return {
    ...result,
    status: "broken",
  };
}

function getTimeoutConfirmationMs(timeout: number): number {
  return Math.max(timeout * 2, 10_000);
}

async function requestAndClassify(
  bookmark: ExtractedBookmark,
  method: "HEAD" | "GET",
  attempt: number,
  timeout: number,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<BookmarkCheckResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetcher(bookmark.url, {
      method,
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      redirect: "follow",
      headers: method === "GET" ? { ...defaultHeaders, range: "bytes=0-0" } : defaultHeaders,
    });

    await response.body?.cancel?.();

    return classifyHttpStatus(bookmark, response.status, method, attempt);
  } catch (error) {
    signal?.throwIfAborted();
    return classifyRequestError(bookmark, error, method, attempt);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function isRetryable(result: BookmarkCheckResult): boolean {
  return ["empty_response", "timeout", "server_error", "network_error", "ssl_error"].includes(result.reason);
}
