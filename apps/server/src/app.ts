import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { upgradeWebSocket } from "@hono/node-server";
import { z } from "zod";
import { parseBookmarkHtml } from "@marksweep/core/parser/bookmark-html";
import { createBookmarkHtmlDocument, renderBookmarkHtml } from "@marksweep/core/writer/bookmark-html";
import { bookmarksSchema, aiOptionsSchema } from "@marksweep/core/protocol";
import { getPublicConfig, saveAiSettings } from "./config.js";
import { createTaskSocket } from "./socket.js";
import type { TaskDependencies } from "./tasks.js";

export function createApp(allowedOrigins: Set<string>, dependencies?: TaskDependencies) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    const origin = c.req.header("origin");
    if (!allowedOrigins.has(url.origin) || (origin && !allowedOrigins.has(origin))) {
      return c.json({ error: "只允许从本地工作台访问。" }, 403);
    }
    if (c.req.path === "/ws" && (!origin || !allowedOrigins.has(origin))) {
      return c.json({ error: "WebSocket 来源无效。" }, 403);
    }
    if (c.req.method === "POST" && !c.req.header("content-type")?.startsWith("application/json")) {
      return c.json({ error: "请求必须使用 JSON。" }, 415);
    }
    await next();
  });
  app.use(
    "/api/*",
    bodyLimit({ maxSize: 16 * 1024 * 1024, onError: (c) => c.json({ error: "书签数据不能超过 16 MB。" }, 413) }),
  );
  app.get("/api/config", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await getPublicConfig());
  });
  app.post("/api/config", async (c) => {
    const { ai } = z.object({ ai: aiOptionsSchema, confirmSave: z.literal(true) }).parse(await c.req.json<unknown>());
    c.header("Cache-Control", "no-store");
    return c.json(await saveAiSettings(ai));
  });
  app.post("/api/import", async (c) => {
    const { html } = z.object({ html: z.string().min(1) }).parse(await c.req.json<unknown>());
    try {
      return c.json(parseBookmarkHtml(html));
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "书签 HTML 无法解析。" });
    }
  });
  app.post("/api/export", async (c) => {
    const { bookmarks, title } = z
      .object({ bookmarks: bookmarksSchema, title: z.string().max(1000).default("Bookmarks") })
      .parse(await c.req.json<unknown>());
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Disposition", 'attachment; filename="bookmarks.organized.html"');
    return c.body(renderBookmarkHtml(createBookmarkHtmlDocument(bookmarks, { title })));
  });
  app.get(
    "/ws",
    upgradeWebSocket(() => createTaskSocket(dependencies)),
  );
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: "请求参数无效。" }, 400);
    return c.json({ error: "本地服务处理失败，请检查配置或重试。" }, 500);
  });
  return app;
}
