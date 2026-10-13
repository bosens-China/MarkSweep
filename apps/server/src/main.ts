#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { access } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import { config as loadDotEnv } from "dotenv";
import { installAutoProxy } from "@marksweep/core/config/proxy";
import { createApp } from "./app.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("MarkSweep 本地书签工作台\n\n用法：marksweep [--port <端口>] [--no-open]\n按 Ctrl+C 退出。");
} else {
  start().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function start(): Promise<void> {
  const development = args.includes("--dev");
  const portIndex = args.indexOf("--port");
  const port = portIndex < 0 ? 0 : Number(args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("端口必须是 0–65535 的整数。");
  const root = fileURLToPath(new URL(development ? "../../../" : "../../", import.meta.url));
  const webRoot = path.join(root, "dist/web");
  if (!development)
    await access(path.join(webRoot, "index.html")).catch(() => {
      throw new Error("找不到界面文件，请先运行 pnpm build。");
    });
  loadDotEnv({ quiet: true });
  installAutoProxy();
  const origins = new Set<string>();
  const app = createApp(origins);
  if (!development) app.use("*", serveStatic({ root: webRoot }));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port, websocket: { server: wss } });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法获得本地服务端口。");
  const backendUrl = `http://127.0.0.1:${address.port}`;
  origins.add(backendUrl);
  let url = backendUrl;
  let closeVite: (() => Promise<void>) | undefined;
  try {
    if (development) {
      const { createServer } = await import("vite");
      const vite = await createServer({
        configFile: path.join(root, "apps/web/vite.config.ts"),
        server: {
          host: "127.0.0.1",
          port: 0,
          proxy: {
            "/api": { target: backendUrl, changeOrigin: true },
            "/ws": { target: backendUrl, ws: true, changeOrigin: true },
          },
        },
      });
      closeVite = () => vite.close();
      await vite.listen();
      url = vite.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? backendUrl;
      origins.add(new URL(url).origin);
    }
  } catch (error) {
    await closeVite?.();
    wss.close();
    server.close();
    throw error;
  }
  console.log(`\nMarkSweep 已启动：${url}\n按 Ctrl+C 退出。\n`);
  if (!args.includes("--no-open")) openBrowser(url);
  const stop = async () => {
    for (const client of wss.clients) client.close(1001, "本地服务已停止");
    await closeVite?.();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", () => console.log(`请手动打开浏览器：${url}`));
  child.unref();
}
