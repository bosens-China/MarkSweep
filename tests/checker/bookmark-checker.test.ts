import { describe, expect, it } from "vitest";
import {
  checkBookmark,
  checkBookmarks,
  summarizeCheckResults,
  type CheckBookmarksProgress,
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

    await expect(
      checkBookmark(createBookmark("https://bad-gateway.test"), defaultOptions(), fetchStatus(502)),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "server_error",
      httpStatus: 502,
    });
  });

  it("tries the HTTPS URL before treating an HTTP bookmark as broken", async () => {
    const fetcher: FetchLike = async (url) => ({
      status: url.startsWith("https://") ? 200 : 404,
    });

    await expect(
      checkBookmark(createBookmark("http://legacy.example.com/#/docs"), defaultOptions(), fetcher),
    ).resolves.toMatchObject({
      status: "valid",
      reason: "https_upgrade",
      bookmark: {
        url: "https://legacy.example.com/#/docs",
        attributes: {
          href: "https://legacy.example.com/#/docs",
        },
      },
    });
  });

  it("keeps the original HTTP failure when HTTPS also fails", async () => {
    await expect(
      checkBookmark(createBookmark("http://missing.example.com/page"), defaultOptions(), fetchStatus(404)),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "not_found",
      bookmark: {
        url: "http://missing.example.com/page",
      },
    });
  });

  it("keeps auth, forbidden, and rate limit as suspicious", async () => {
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
  });

  it("uses one extended confirmation retry before deleting a timed out bookmark", async () => {
    const requestedMethods: Array<"HEAD" | "GET"> = [];
    const fetcher: FetchLike = async (_url, init) => {
      requestedMethods.push(init.method);

      if (requestedMethods.length < 3) {
        const error = new Error("This operation was aborted") as Error & { code?: string };
        error.code = "AbortError";
        throw error;
      }

      return { status: 200 };
    };

    await expect(
      checkBookmark(createBookmark("https://slow-then-ok.test"), defaultOptions(), fetcher),
    ).resolves.toMatchObject({
      status: "valid",
      reason: "ok",
      method: "GET",
      attempts: 2,
    });
    expect(requestedMethods).toEqual(["HEAD", "GET", "GET"]);
  });

  it("classifies a bookmark as broken when the extended timeout retry also times out", async () => {
    await expect(
      checkBookmark(
        createBookmark("https://always-slow.test"),
        defaultOptions(),
        throwingFetcher("AbortError", "This operation was aborted"),
      ),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "timeout",
      method: "GET",
      attempts: 2,
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

    await expect(
      checkBookmark(
        createBookmark("https://protocol.test"),
        defaultOptions(),
        throwingFetcher("ERR_HTTP2_PROTOCOL_ERROR", "HTTP/2 stream was not closed cleanly: PROTOCOL_ERROR"),
      ),
    ).resolves.toMatchObject({
      status: "broken",
      reason: "protocol_error",
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

  it("reports progress as each bookmark is checked", async () => {
    const progress: CheckBookmarksProgress[] = [];

    await checkBookmarks(
      [
        createBookmark("https://first.test"),
        createBookmark("https://second.test"),
        createBookmark("chrome://settings", false),
      ],
      defaultOptions(),
      {
        fetcher: fetchStatus(200),
        onProgress: (item) => progress.push(item),
      },
    );

    expect(progress.map((item) => item.completed)).toEqual([1, 2, 3]);
    expect(progress.map((item) => item.total)).toEqual([3, 3, 3]);
    expect(progress.map((item) => item.bookmark.url)).toEqual([
      "https://first.test",
      "https://second.test",
      "chrome://settings",
    ]);
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
