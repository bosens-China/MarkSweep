import { useEffect, useRef, useState } from "react";
import { loadWorkspace, saveWorkspace, type WorkspaceSnapshot } from "./workspace-storage";

export function useWorkspacePersistence(snapshot: WorkspaceSnapshot, onRestore: (saved: WorkspaceSnapshot) => void) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");
  const restore = useRef(onRestore);
  const writes = useRef(Promise.resolve());
  const revision = useRef(0);
  const failedRead = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    restore.current = onRestore;
  });
  useEffect(() => {
    let disposed = false;
    void loadWorkspace()
      .then((saved) => {
        if (!disposed && saved) restore.current(saved);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          failedRead.current = true;
          setError(error instanceof Error ? error.message : "恢复缓存不可用。");
          setState("error");
        }
      })
      .finally(() => {
        if (!disposed) setReady(true);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!ready || failedRead.current) return;
    const current = ++revision.current;
    let disposed = false;
    setState("saving");
    const timer = setTimeout(() => {
      writes.current = writes.current
        .catch(() => undefined)
        .then(() =>
          current === revision.current ? saveWorkspace(snapshot.filename ? snapshot : undefined) : undefined,
        );
      void writes.current
        .then(() => {
          if (!disposed && current === revision.current) {
            setState("saved");
            setError("");
          }
        })
        .catch((error: unknown) => {
          if (!disposed && current === revision.current) {
            setState("error");
            setError(error instanceof Error ? error.message : "保存恢复缓存失败，请及时导出。");
          }
        });
    }, 300);
    timerRef.current = timer;
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [ready, snapshot]);
  useEffect(() => {
    if (!snapshot.filename || state === "saved") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [snapshot.filename, state]);
  async function clear() {
    ++revision.current;
    clearTimeout(timerRef.current);
    await writes.current.catch(() => undefined);
    await saveWorkspace(undefined);
    failedRead.current = false;
    setState("saved");
    setError("");
  }
  return { ready, state, error, clear };
}
