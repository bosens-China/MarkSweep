import type { BookmarkCheckReason, BookmarkCheckResult, BookmarkCheckSummary } from "./types.js";

const unreliableNetworkReasons: BookmarkCheckReason[] = [
  "timeout",
  "network_error",
  "ssl_error",
  "dns_not_found",
  "connection_refused",
  "empty_response",
  "protocol_error",
];

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
