import { describe, expect, it, afterEach, vi } from "vitest";
import { createApp } from "../../apps/server/src/app";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";

const origin = "http://127.0.0.1:4010";
const app = createApp(new Set([origin]));
const html =
  '<!DOCTYPE NETSCAPE-Bookmark-file-1><H1>收藏</H1><DL><p><DT><H3>技术</H3><DL><p><DT><A HREF="https://example.com" ADD_DATE="123">Example</A></DL><p></DL>';
const post = (path: string, body: unknown, headers = {}) =>
  app.request(`${origin}/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body),
  });

describe("local Hono API", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("imports and exports bookmarks without losing folders or attributes", async () => {
    const imported = await post("import", { html });
    expect(imported.status).toBe(200);
    const parsed = (await imported.json()) as ReturnType<typeof parseBookmarkHtml>;
    expect(parsed.bookmarks[0]?.folderPath).toEqual(["技术"]);
    const exported = await post("export", { bookmarks: parsed.bookmarks, title: parsed.rootTitle });
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    const roundtrip = parseBookmarkHtml(await exported.text());
    expect(roundtrip.bookmarks).toEqual(parsed.bookmarks);
    expect(roundtrip.rootTitle).toBe("收藏");
  });
  it("rejects remote origins, unknown hosts and WebSocket requests without an origin", async () => {
    expect((await post("import", { html }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await app.request("http://evil.example/api/config")).status).toBe(403);
    expect((await app.request(`${origin}/ws`)).status).toBe(403);
  });
  it("rejects invalid JSON, invalid bookmarks and oversized uploads", async () => {
    expect((await post("import", { html: "invalid" })).status).toBe(400);
    expect((await post("export", { bookmarks: [{ url: "https://example.com" }] })).status).toBe(400);
    const invalidJson = await app.request(`${origin}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    const tooLarge = await app.request(`${origin}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(17 * 1024 * 1024) },
      body: "{}",
    });
    expect(tooLarge.status).toBe(413);
    expect((await app.request(`${origin}/api/import`, { method: "POST", body: html })).status).toBe(415);
  });
  it("returns AI defaults without exposing the stored API key", async () => {
    vi.stubEnv("MARKSWEEP_CONFIG_PATH", "/nonexistent/marksweep-test-config.json");
    vi.stubEnv("MARKSWEEP_AI_API_KEY", "secret-must-not-leak");
    const response = await app.request(`${origin}/api/config`);
    const text = await response.text();
    expect(text).not.toContain("secret-must-not-leak");
    expect(JSON.parse(text)).toMatchObject({ hasApiKey: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
