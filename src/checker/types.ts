import type { ExtractedBookmark } from "../parser/bookmark-html.js";

export type BookmarkCheckStatus = "valid" | "broken" | "suspicious" | "skipped";

export type BookmarkCheckReason =
  | "ok"
  | "redirect"
  | "not_found"
  | "gone"
  | "dns_not_found"
  | "connection_refused"
  | "empty_response"
  | "timeout"
  | "auth_required"
  | "forbidden"
  | "rate_limited"
  | "ssl_error"
  | "server_error"
  | "http_error"
  | "network_error"
  | "non_web_url"
  | "https_upgrade"
  | "protocol_error";

export interface BookmarkCheckResult {
  bookmark: ExtractedBookmark;
  status: BookmarkCheckStatus;
  reason: BookmarkCheckReason;
  attempts: number;
  method?: "HEAD" | "GET";
  httpStatus?: number;
  error?: string;
}

export interface BookmarkCheckSummary {
  total: number;
  valid: number;
  broken: number;
  suspicious: number;
  skipped: number;
  networkMayBeUnreliable: boolean;
}
