import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BookmarkFolderNode, BookmarkHtmlDocument } from "../writer/bookmark-html.js";

export function renderBookmarkTreePreview(document: BookmarkHtmlDocument): string {
  const title = escapeHtml(document.title ?? "Bookmarks");
  const tree = [
    ...document.folders.map((folder) => renderFolder(folder, 1)),
    document.bookmarks.length > 0
      ? `<section class="root-bookmarks"><h2>根目录 <small>${document.bookmarks.length} 个</small></h2>${renderBookmarks(document.bookmarks)}</section>`
      : "",
  ].join("");
  const bookmarkCount =
    document.bookmarks.length + document.folders.reduce((total, folder) => total + countFolderBookmarks(folder), 0);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; --bg: #fff; --text: #172033; --muted: #64748b; --line: #cbd5e1; --soft: #f1f5f9; --link: #2563eb; }
    * { box-sizing: border-box; }
    body { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; color: var(--text); background: var(--bg); }
    header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 26px; }
    header p { margin: 6px 0 0; color: var(--muted); }
    .actions { display: flex; gap: 8px; }
    input[type="search"] { width: min(280px, 70vw); padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--bg); }
    button { padding: 7px 12px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--bg); cursor: pointer; }
    button:hover { background: var(--soft); }
    h2 { font-size: 18px; }
    details { margin: 8px 0 8px 36px; padding-left: 18px; border-left: 3px solid #93c5fd; }
    details[data-depth="1"] { margin: 14px 0; padding: 12px 16px; border: 1px solid var(--line); border-left: 5px solid var(--link); border-radius: 8px; }
    details[data-depth="2"] { margin-left: 44px; border-left-color: #a78bfa; }
    details[data-depth="3"] { margin-left: 52px; border-left-color: #f59e0b; }
    summary { padding: 4px 0; cursor: pointer; font-weight: 650; }
    details[data-depth="1"] > summary { font-size: 18px; }
    .count { margin-left: 8px; padding: 2px 7px; border-radius: 999px; color: var(--muted); background: var(--soft); font-size: 12px; font-weight: 500; }
    ul { margin: 10px 0 14px 34px; padding-left: 20px; }
    li { margin: 7px 0; }
    a { color: var(--link); text-decoration: none; overflow-wrap: anywhere; }
    a:hover { text-decoration: underline; }
    small, code { opacity: .65; }
    .root-bookmarks { margin-top: 18px; }
    @media (prefers-color-scheme: dark) {
      :root { color-scheme: dark; --bg: #111827; --text: #e5e7eb; --muted: #94a3b8; --line: #374151; --soft: #1f2937; --link: #60a5fa; }
    }
  </style>
</head>
<body>
  <header>
    <div><h1>${title}</h1><p>共 ${bookmarkCount} 个书签 · ${document.folders.length} 个一级目录</p></div>
    <div class="actions">
      <input id="search" type="search" placeholder="搜索标题或 URL" aria-label="搜索书签">
      <button type="button" data-action="expand">一键展开</button>
      <button type="button" data-action="collapse">一键收起</button>
    </div>
  </header>
  <main>${tree}</main>
  <script>
    const folders = [...document.querySelectorAll("details")];
    const items = [...document.querySelectorAll("li")];
    document.querySelector(".actions").addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action === "expand") document.querySelectorAll("details").forEach((item) => item.open = true);
      if (action === "collapse") document.querySelectorAll("details").forEach((item) => item.open = item.dataset.depth === "1");
    });
    document.querySelector("#search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      items.forEach((item) => {
        const url = item.querySelector("a")?.getAttribute("href") ?? item.querySelector("code")?.textContent ?? "";
        item.hidden = Boolean(query) && !(item.textContent + " " + url).toLowerCase().includes(query);
      });
      [...folders].reverse().forEach((folder) => {
        const matched = [...folder.querySelectorAll("li")].some((item) => !item.hidden);
        folder.hidden = Boolean(query) && !matched;
        folder.open = query ? matched : folder.dataset.depth === "1";
      });
      const root = document.querySelector(".root-bookmarks");
      if (root) root.hidden = Boolean(query) && ![...root.querySelectorAll("li")].some((item) => !item.hidden);
    });
  </script>
</body>
</html>
`;
}

export async function openBookmarkTreePreview(document: BookmarkHtmlDocument): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "marksweep-preview-"));
  const previewPath = path.join(directory, "bookmarks.html");
  await writeFile(previewPath, renderBookmarkTreePreview(document), "utf8");
  await openFileInBrowser(previewPath);
  return previewPath;
}

function renderFolder(folder: BookmarkFolderNode, depth: number): string {
  return `<details data-depth="${depth}"${depth === 1 ? " open" : ""}><summary>${escapeHtml(folder.title)}<small class="count">${countFolderBookmarks(folder)} 个</small></summary>${renderBookmarks(folder.bookmarks)}${folder.folders.map((child) => renderFolder(child, depth + 1)).join("")}</details>`;
}

function countFolderBookmarks(folder: BookmarkFolderNode): number {
  return folder.bookmarks.length + folder.folders.reduce((total, child) => total + countFolderBookmarks(child), 0);
}

function renderBookmarks(bookmarks: BookmarkFolderNode["bookmarks"]): string {
  if (bookmarks.length === 0) {
    return "";
  }

  return `<ul>${bookmarks
    .map((bookmark) => {
      const title = escapeHtml(bookmark.title);
      return bookmark.isWebUrl
        ? `<li><a href="${escapeAttribute(bookmark.url)}" target="_blank" rel="noreferrer">${title}</a></li>`
        : `<li><span>${title}</span><code>${escapeHtml(bookmark.url)}</code></li>`;
    })
    .join("")}</ul>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function openFileInBrowser(filePath: string): Promise<void> {
  const url = pathToFileURL(filePath).href;
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}
