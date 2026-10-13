import type { AiOptions, ImportedBookmarks, PublicConfig } from "@marksweep/core/protocol";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";

async function request(path: string, body?: unknown): Promise<Response> {
  const response = await fetch(
    `/api/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "本地服务请求失败。");
  }
  return response;
}

export async function importBookmarks(html: string): Promise<ImportedBookmarks> {
  return (await request("import", { html })).json() as Promise<ImportedBookmarks>;
}

export async function getConfig(): Promise<PublicConfig> {
  return (await request("config")).json() as Promise<PublicConfig>;
}

export async function saveConfig(ai: AiOptions): Promise<PublicConfig> {
  return (await request("config", { ai, confirmSave: true })).json() as Promise<PublicConfig>;
}

export async function exportBookmarks(bookmarks: ExtractedBookmark[], title: string, filename: string): Promise<void> {
  download(await (await request("export", { bookmarks, title })).blob(), filename);
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
