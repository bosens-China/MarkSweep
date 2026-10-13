import { z } from "zod";
import { bookmarksSchema, checkResultSchema } from "@marksweep/core/protocol";
import { conversationStateSchema } from "./conversation-state";

export const workspaceSnapshotSchema = z.object({
  version: z.literal(1),
  filename: z.string(),
  title: z.string(),
  bookmarks: bookmarksSchema,
  original: bookmarksSchema,
  results: z.record(z.string(), checkResultSchema),
  report: z.string(),
  traceUrl: z.string().refine((url) => !url || (URL.canParse(url) && /^https?:\/\//i.test(url))),
  task: z.enum(["check", "classify", "audit", "organize"]).nullable(),
  conversation: conversationStateSchema.default({ id: "", turns: [] }),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

function sessionId(): string {
  const key = "marksweep:workspace-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("marksweep", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("workspaces");
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开恢复缓存。"));
    request.onblocked = () => reject(new Error("恢复缓存被其他标签页占用，请关闭旧页面后重试。"));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot | undefined> {
  const id = sessionId();
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("workspaces", "readwrite");
    const store = transaction.objectStore("workspaces");
    const current = store.get(id);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      const value = entry.value as { savedAt?: unknown };
      // 清理已关闭标签页遗留的旧快照，当前标签页的副本始终保留。
      if (entry.key !== id && typeof value?.savedAt === "number" && value.savedAt < Date.now() - 7 * 86400000)
        entry.delete();
      entry.continue();
    };
    transaction.oncomplete = () => {
      database.close();
      const value: unknown = current.result;
      if (value === undefined) {
        resolve(undefined);
        return;
      }
      const parsed = z.object({ snapshot: workspaceSnapshotSchema }).safeParse(value);
      if (parsed.success) resolve(parsed.data.snapshot);
      else reject(new Error("恢复缓存格式无效，请导入原始文件继续。"));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("读取恢复缓存失败。"));
    };
  });
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot | undefined): Promise<void> {
  const id = sessionId();
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("workspaces", "readwrite");
    const store = transaction.objectStore("workspaces");
    if (snapshot) store.put({ savedAt: Date.now(), snapshot }, id);
    else store.delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("保存恢复缓存失败。"));
    };
  });
}
