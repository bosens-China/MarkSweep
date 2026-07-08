import { describe, expect, it } from "vitest";
import {
  checkBookmark,
  checkBookmarks,
  summarizeCheckResults,
  type FetchLike,
} from "../../src/checker/bookmark-checker";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("checkBookmark", () => {
  it("marks 2xx and 3xx responses as valid", async () => {
    await expect(
      checkBookmark(createBookmark("https://ok.test"), defaultOptions(), fetchStatus(204)),
    ).resolves.toMatchObject({
      status: "valid",
      reason: "ok",
      httpStatus: 204,
    });

    await expect(
      checkBookmark(createBookmark("https://redirect.test"), defaultOptions(), fetchStatus(301)),
    ).resolves.toMatchObject({
      status: "valid",
      reason: "redirect",
      httpStatus: 301,
    });
  });

  it("falls back from HEAD to GET before deciding", async () => {
    const fetcher: FetchLike = async (_url, init) => ({
      status: init.method === "HEAD" ? 405 : 200,
    });

    await expect(
      checkBookmark(createBookmark("https://fallback.test"), defaultOptions(), fetcher),
    ).resolves.toMatchObject({
      status: "valid",
      reason: "ok",
      method: "GET",
    });
  });

  it("keeps a bookmark suspicious when GET disagrees with a broken HEAD response", async () => {
    const fetcher: FetchLike = async (_url, init) => ({
      status: init.method === "HEAD" ? 404 : 403,
    });

    await expect(
      checkBookmark(createBookmark("https://head-only-missing.test"), defaultOptions(), fetcher),
    ).resolves.toMatchObject({
      status: "suspicious",
      reason: "forbidden",
      method: "GET",
    });
  });

  it("classifies removable broken responses", async () => {
    await expect(
      checkBookmark(createBookmark("https://missing.test"), defaultOptions(), fetchStatus(404)),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "not_found",
    });

    await expect(
      checkBookmark(createBookmark("https://gone.test"), defaultOptions(), fetchStatus(410)),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "gone",
    });
  });

  it("keeps auth, forbidden, rate limit, and timeout as suspicious", async () => {
    await expect(
      checkBookmark(createBookmark("https://auth.test"), defaultOptions(), fetchStatus(401)),
    ).resolves.toMatchObject({
      status: "suspicious",
      reason: "auth_required",
    });

    await expect(
      checkBookmark(createBookmark("https://forbidden.test"), defaultOptions(), fetchStatus(403)),
    ).resolves.toMatchObject({
      status: "suspicious",
      reason: "forbidden",
    });

    await expect(
      checkBookmark(createBookmark("https://limit.test"), defaultOptions(), fetchStatus(429)),
    ).resolves.toMatchObject({
      status: "suspicious",
      reason: "rate_limited",
    });

    await expect(
      checkBookmark(
        createBookmark("https://slow.test"),
        defaultOptions(),
        throwingFetcher("AbortError", "This operation was aborted"),
      ),
    ).resolves.toMatchObject({
      status: "suspicious",
      reason: "timeout",
    });
  });

  it("classifies DNS, refused connections, and empty responses as broken", async () => {
    await expect(
      checkBookmark(
        createBookmark("https://dns.test"),
        defaultOptions(),
        throwingFetcher("ENOTFOUND", "getaddrinfo ENOTFOUND"),
      ),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "dns_not_found",
    });

    await expect(
      checkBookmark(
        createBookmark("https://refused.test"),
        defaultOptions(),
        throwingFetcher("ECONNREFUSED", "connect ECONNREFUSED"),
      ),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "connection_refused",
    });

    await expect(
      checkBookmark(
        createBookmark("https://empty.test"),
        defaultOptions(),
        throwingFetcher("UND_ERR_SOCKET", "other side closed"),
      ),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "empty_response",
    });
  });

  it("skips non-web bookmarks", async () => {
    await expect(
      checkBookmark(createBookmark("chrome://settings", false), defaultOptions(), fetchStatus(200)),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "non_web_url",
      attempts: 0,
    });
  });
});

describe("checkBookmarks", () => {
  it("checks bookmarks with a summary", async () => {
    const results = await checkBookmarks(
      [
        createBookmark("https://ok.test"),
        createBookmark("https://missing.test"),
        createBookmark("chrome://settings", false),
      ],
      defaultOptions(),
      {
        fetcher: async (url) => ({
          status: url.includes("missing") ? 404 : 200,
        }),
      },
    );

    expect(summarizeCheckResults(results)).toEqual({
      total: 3,
      valid: 1,
      broken: 1,
      suspicious: 0,
      skipped: 1,
      networkMayBeUnreliable: false,
    });
  });

  it("marks a batch as unreliable when most web checks are transient network failures", () => {
    const results = Array.from(
      { length: 10 },
      (_, index) =>
        ({
          bookmark: createBookmark(`https://timeout-${index}.test`),
          status: index < 7 ? "suspicious" : "valid",
          reason: index < 7 ? "timeout" : "ok",
          attempts: 1,
        }) as const,
    );

    expect(summarizeCheckResults(results)).toMatchObject({
      networkMayBeUnreliable: true,
      suspicious: 7,
      valid: 3,
    });
  });

  it("marks a batch as unreliable when most web checks are network-classified broken failures", () => {
    const networkReasons = ["dns_not_found", "connection_refused", "empty_response"] as const;
    const results = Array.from(
      { length: 10 },
      (_, index) =>
        ({
          bookmark: createBookmark(`https://network-${index}.test`),
          status: index < 6 ? "broken" : "valid",
          reason: index < 6 ? networkReasons[index % networkReasons.length] : "ok",
          attempts: 1,
        }) as const,
    );

    expect(summarizeCheckResults(results)).toMatchObject({
      networkMayBeUnreliable: true,
      broken: 6,
      valid: 4,
    });
  });
});

function defaultOptions() {
  return {
    concurrency: 2,
    timeout: 100,
    retries: 0,
  };
}

function createBookmark(url: string, isWebUrl = true): ExtractedBookmark {
  return {
    id: url,
    title: url,
    url,
    folderPath: [],
    attributes: {
      href: url,
    },
    isWebUrl,
  };
}

function fetchStatus(status: number): FetchLike {
  return async () => ({ status });
}

function throwingFetcher(code: string, message: string): FetchLike {
  return async () => {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    throw error;
  };
}
