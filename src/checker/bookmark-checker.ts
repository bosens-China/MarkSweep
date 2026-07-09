import { fetch as undiciFetch } from "undici";
import pLimit from "p-limit";
import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import type { BookmarkCheckReason, BookmarkCheckResult, BookmarkCheckStatus, BookmarkCheckSummary } from "./types.js";

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
  fetcher?: FetchLike;
  onProgress?: (progress: CheckBookmarksProgress) => void;
}

const defaultHeaders = {
  "user-agent": "MarkSweep/0.1 (+https://www.npmjs.com/package/@boses/marksweep)",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};
const unreliableNetworkReasons: BookmarkCheckReason[] = [
  "timeout",
  "network_error",
  "ssl_error",
  "dns_not_found",
  "connection_refused",
  "empty_response",
  "protocol_error",
];

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
        const result = await checkBookmark(bookmark, options, fetcher);
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
): Promise<BookmarkCheckResult> {
  const result = await checkBookmarkUrl(bookmark, options, fetcher);
  const httpsBookmark = createHttpsBookmark(bookmark);

  if (result.status === "valid" || !httpsBookmark) {
    return result;
  }

  const httpsResult = await checkBookmarkUrl(httpsBookmark, options, fetcher);

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
    const headResult = await requestAndClassify(bookmark, "HEAD", attempt, options.timeout, fetcher);

    if (headResult.status === "valid") {
      return headResult;
    }

    lastResult = await requestAndClassify(bookmark, "GET", attempt, options.timeout, fetcher);

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

  return confirmTimeoutResult(bookmark, options, maxAttempts + 1, fetcher);
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
): Promise<BookmarkCheckResult> {
  const result = await requestAndClassify(bookmark, "GET", attempt, getTimeoutConfirmationMs(options.timeout), fetcher);

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

export function summarizeCheckResults(results: BookmarkCheckResult[]): BookmarkCheckSummary {
  const summary: BookmarkCheckSummary = {
    total: results.length,
    valid: 0,
    broken: 0,
    suspicious: 0,
    skipped: 0,
    networkMayBeUnreliable: false,
  };

  for (const result of results) {
    summary[result.status] += 1;
  }

  const webResults = results.filter((result) => result.status !== "skipped");
  const transientNetworkFailures = webResults.filter((result) => unreliableNetworkReasons.includes(result.reason));

  summary.networkMayBeUnreliable =
    webResults.length >= 10 && transientNetworkFailures.length / webResults.length >= 0.6;

  return summary;
}

async function requestAndClassify(
  bookmark: ExtractedBookmark,
  method: "HEAD" | "GET",
  attempt: number,
  timeout: number,
  fetcher: FetchLike,
): Promise<BookmarkCheckResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetcher(bookmark.url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: method === "GET" ? { ...defaultHeaders, range: "bytes=0-0" } : defaultHeaders,
    });

    await response.body?.cancel?.();

    return classifyHttpStatus(bookmark, response.status, method, attempt);
  } catch (error) {
    return classifyRequestError(bookmark, error, method, attempt);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function classifyHttpStatus(
  bookmark: ExtractedBookmark,
  httpStatus: number,
  method: "HEAD" | "GET",
  attempts: number,
): BookmarkCheckResult {
  if (httpStatus >= 200 && httpStatus < 300) {
    return { bookmark, status: "valid", reason: "ok", method, attempts, httpStatus };
  }

  if (httpStatus >= 300 && httpStatus < 400) {
    return { bookmark, status: "valid", reason: "redirect", method, attempts, httpStatus };
  }

  if (httpStatus === 404) {
    return { bookmark, status: "broken", reason: "not_found", method, attempts, httpStatus };
  }

  if (httpStatus === 410) {
    return { bookmark, status: "broken", reason: "gone", method, attempts, httpStatus };
  }

  if (httpStatus === 401) {
    return { bookmark, status: "suspicious", reason: "auth_required", method, attempts, httpStatus };
  }

  if (httpStatus === 403) {
    return { bookmark, status: "suspicious", reason: "forbidden", method, attempts, httpStatus };
  }

  if (httpStatus === 429) {
    return { bookmark, status: "suspicious", reason: "rate_limited", method, attempts, httpStatus };
  }

  if (httpStatus === 502) {
    return { bookmark, status: "broken", reason: "server_error", method, attempts, httpStatus };
  }

  if (httpStatus >= 500) {
    return { bookmark, status: "suspicious", reason: "server_error", method, attempts, httpStatus };
  }

  return { bookmark, status: "suspicious", reason: "http_error", method, attempts, httpStatus };
}

function classifyRequestError(
  bookmark: ExtractedBookmark,
  error: unknown,
  method: "HEAD" | "GET",
  attempts: number,
): BookmarkCheckResult {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  const reason = classifyErrorReason(code, message);
  const status: BookmarkCheckStatus = [
    "dns_not_found",
    "connection_refused",
    "empty_response",
    "protocol_error",
  ].includes(reason)
    ? "broken"
    : "suspicious";

  return {
    bookmark,
    status,
    reason,
    method,
    attempts,
    error: message,
  };
}

function classifyErrorReason(code: string | undefined, message: string): BookmarkCheckReason {
  const lowerMessage = message.toLowerCase();

  if (code === "ABORT_ERR" || code === "AbortError" || lowerMessage.includes("abort")) {
    return "timeout";
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "dns_not_found";
  }

  if (code === "ECONNREFUSED") {
    return "connection_refused";
  }

  if (
    code === "ECONNRESET" ||
    code === "UND_ERR_SOCKET" ||
    lowerMessage.includes("empty response") ||
    lowerMessage.includes("socket hang up") ||
    lowerMessage.includes("other side closed") ||
    lowerMessage.includes("terminated")
  ) {
    return "empty_response";
  }

  if (code === "ERR_HTTP2_PROTOCOL_ERROR" || lowerMessage.includes("protocol_error")) {
    return "protocol_error";
  }

  if (
    code?.includes("CERT") ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    lowerMessage.includes("certificate")
  ) {
    return "ssl_error";
  }

  return "network_error";
}

function isRetryable(result: BookmarkCheckResult): boolean {
  return ["empty_response", "timeout", "server_error", "network_error", "ssl_error"].includes(result.reason);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { code?: unknown; name?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") {
    return candidate.code;
  }

  const cause = candidate.cause;
  if (cause && typeof cause === "object" && typeof (cause as { code?: unknown }).code === "string") {
    return (cause as { code: string }).code;
  }

  return typeof candidate.name === "string" ? candidate.name : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }

  return String(error);
}
