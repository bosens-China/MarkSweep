import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import type { BookmarkCheckReason, BookmarkCheckResult, BookmarkCheckStatus } from "./types.js";

export function classifyHttpStatus(
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

export function classifyRequestError(
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
