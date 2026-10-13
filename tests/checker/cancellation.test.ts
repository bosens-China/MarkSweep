import { describe, expect, it, vi } from "vitest";
import { checkBookmarks, type FetchLike } from "@marksweep/core/checker/bookmark-checker";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";

describe("bookmark check cancellation", () => {
  it("aborts requests without retries or a broken-link verdict", async () => {
    const bookmarks = parseBookmarkHtml('<DL><p><DT><A HREF="https://example.com">Example</A></DL>').bookmarks;
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn<FetchLike>(
      (_url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          started();
        }),
    );
    const pending = checkBookmarks(
      bookmarks,
      { concurrency: 1, timeout: 10000, retries: 2 },
      { fetcher, signal: controller.signal },
    );
    await ready;
    const rejected = expect(pending).rejects.toThrow("cancelled");
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
