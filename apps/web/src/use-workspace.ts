import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { dedupeBookmarks } from "@marksweep/core/bookmarks/dedupe";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";
import type { BookmarkCheckResult } from "@marksweep/core/checker/types";
import type { TaskEvent, TaskRequest } from "@marksweep/core/protocol";
import { getConfig, saveConfig, importBookmarks, exportBookmarks, download } from "./api";
import {
  createCheckReport,
  stringifyCheckReport,
  parseCheckReport,
  matchCheckReport,
} from "@marksweep/core/report/check-report-file";
import { defaultSettings } from "./settings";
import { useTaskSocket } from "./use-task-socket";
import { useWorkspacePersistence } from "./use-workspace-persistence";
import { useConversation } from "./use-conversation";

export function useWorkspace() {
  const { message } = App.useApp();
  const [bookmarks, setBookmarks] = useState<ExtractedBookmark[]>([]);
  const [original, setOriginal] = useState<ExtractedBookmark[]>([]);
  const [filename, setFilename] = useState("");
  const [title, setTitle] = useState("Bookmarks");
  const [results, setResults] = useState<Record<string, BookmarkCheckResult>>({});
  const [report, setReport] = useState("");
  const [settings, setSettings] = useState(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [traceUrl, setTraceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<TaskRequest["task"] | null>(null);
  const [status, setStatus] = useState("导入书签，开始整理。");
  const [percent, setPercent] = useState<number>();
  const active = useRef<string | null>(null);
  const conversation = useConversation();
  const snapshot = useMemo(
    () => ({
      version: 1 as const,
      bookmarks,
      original,
      filename,
      title,
      results,
      report,
      traceUrl,
      task: running,
      conversation: conversation.state,
    }),
    [bookmarks, original, filename, title, results, report, traceUrl, running, conversation.state],
  );
  const persistence = useWorkspacePersistence(snapshot, (saved) => {
    setBookmarks(saved.bookmarks);
    setOriginal(saved.original);
    setFilename(saved.filename);
    setTitle(saved.title);
    setResults(saved.results);
    setReport(saved.report);
    setTraceUrl(saved.traceUrl);
    conversation.restore(saved.conversation);
    setStatus(
      saved.task ? "已恢复工作副本和部分结果，上次未完成的任务需要重新执行。" : "已恢复上次工作副本，请继续整理。",
    );
  });

  useEffect(() => {
    let disposed = false;
    void getConfig()
      .then((config) => {
        if (disposed) return;
        setSettings({
          ...defaultSettings,
          ai: { ...defaultSettings.ai, ...config.ai },
          options: { ...defaultSettings.options, langsmith: config.langsmith },
        });
        setHasApiKey(config.hasApiKey);
        setConfigPath(config.configPath);
      })
      .catch((error: unknown) => {
        if (!disposed) void message.error(error instanceof Error ? error.message : "无法读取本机配置。");
      });
    return () => {
      disposed = true;
    };
  }, [message]);

  function finish() {
    active.current = null;
    setRunning(null);
    setPercent(undefined);
  }
  function handleEvent(event: TaskEvent) {
    if (!active.current || (event.requestId && event.requestId !== active.current)) return;
    conversation.receive(event);
    if (event.type === "activity") return;
    if (event.type === "progress") {
      setStatus(event.message);
      if (event.total) setPercent(Math.round(((event.completed ?? 0) / event.total) * 100));
    } else if (event.type === "check") {
      setResults((previous) => ({ ...previous, [event.result.bookmark.id]: event.result }));
      if (event.result.reason === "https_upgrade") {
        setBookmarks((previous) =>
          previous.map((bookmark) => (bookmark.id === event.result.bookmark.id ? event.result.bookmark : bookmark)),
        );
      }
    } else if (event.type === "token") {
      setReport((previous) => previous + event.token);
    } else if (event.type === "trace") {
      setTraceUrl(event.url);
    } else if (event.type === "warning") {
      void message.warning(event.message);
    } else if (event.type === "complete") {
      if (event.bookmarks) {
        setBookmarks(event.bookmarks);
        setResults({});
      }
      if (event.report !== undefined) setReport(event.report);
      setStatus(
        event.summary
          ? `检测完成：有效 ${event.summary.valid}，失效 ${event.summary.broken}，待复核 ${event.summary.suspicious}。`
          : "任务已完成，请核对结果。",
      );
      if (event.summary?.networkMayBeUnreliable)
        void message.warning("大量请求出现网络故障，请检查网络后重试，暂勿批量删除。");
      finish();
    } else {
      const text = event.type === "cancelled" ? "任务已取消，已收到的结果保留。" : event.message;
      setStatus(text);
      if (event.type === "error") void message.error(text);
      finish();
    }
  }
  const socket = useTaskSocket(handleEvent, () => {
    if (active.current) {
      conversation.receive({ type: "error", requestId: active.current, message: "连接已断开，本轮未应用更改。" });
      setStatus("连接已断开，任务已停止。已收到的结果保留。");
      finish();
    }
  });

  async function safely(action: () => Promise<void>) {
    setLoading(true);
    try {
      await action();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setLoading(false);
    }
  }

  function importFile(file: File) {
    if (!/\.html?$/i.test(file.name)) {
      void message.error("请选择浏览器导出的 HTML 书签文件。");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      void message.error("请选择 10 MB 以内的书签文件。");
      return;
    }
    void safely(async () => {
      const parsed = await importBookmarks(await file.text());
      setBookmarks(parsed.bookmarks);
      setOriginal(parsed.bookmarks);
      setTitle(parsed.rootTitle);
      setFilename(file.name);
      setResults({});
      setReport("");
      setTraceUrl("");
      conversation.reset();
      setStatus(`已导入 ${parsed.bookmarks.length} 个书签。所有修改仅作用于当前工作副本。`);
    });
  }

  function run(task: TaskRequest["task"], instruction = "") {
    if (active.current || !bookmarks.length) return false;
    if (task !== "check" && (!settings.ai.model || (!settings.ai.apiKey && !hasApiKey))) {
      setSettingsOpen(true);
      void message.info("请先配置 AI 模型和 API Key。");
      return false;
    }
    const requestId = crypto.randomUUID();
    active.current = requestId;
    setRunning(task);
    setPercent(undefined);
    setStatus("任务已启动⋯⋯");
    if (task === "check") setResults({});
    if (task === "audit") setReport("");
    setTraceUrl("");
    try {
      socket.send({
        type: "run",
        requestId,
        task,
        bookmarks,
        ...settings,
        ...(task === "organize" ? { conversation: conversation.begin(requestId, bookmarks, instruction) } : {}),
      });
      return true;
    } catch (error) {
      conversation.receive({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : "无法启动任务。",
      });
      finish();
      void message.error(error instanceof Error ? error.message : "无法启动任务。");
      return false;
    }
  }

  function dedupe() {
    const result = dedupeBookmarks(bookmarks);
    setBookmarks(result.bookmarks);
    setStatus(`去重完成，移除 ${bookmarks.length - result.bookmarks.length} 个重复书签。可恢复原始导入。`);
  }

  function restore() {
    setBookmarks(original);
    setResults({});
    setReport("");
    setStatus("已恢复原始导入的书签。");
  }
  function cancel() {
    if (active.current) {
      socket.cancel(active.current);
      setStatus("正在取消任务⋯⋯");
    }
  }
  function save() {
    void safely(() => exportBookmarks(bookmarks, title, filename.replace(/\.html?$/i, "") + ".organized.html"));
  }

  function saveAiConfig() {
    void safely(async () => {
      const saved = await saveConfig(settings.ai);
      setHasApiKey(saved.hasApiKey);
      setConfigPath(saved.configPath);
      void message.success("AI 配置已保存到本机。");
    });
  }

  function importReport(file: File) {
    if (!/\.json$/i.test(file.name) || file.size > 16 * 1024 * 1024) {
      void message.error("请选择 16 MB 以内的 MarkSweep JSON 检测报告。");
      return;
    }
    void safely(async () => {
      const report = parseCheckReport(JSON.parse(await file.text()) as unknown);
      const matched = matchCheckReport(bookmarks, report);
      if (!matched.length) throw new Error("报告中没有与当前书签匹配的 URL，未修改检测结果。");
      setResults(Object.fromEntries(matched.map((result) => [result.bookmark.id, result])));
      const upgraded = new Map(matched.map((result) => [result.bookmark.id, result.bookmark]));
      setBookmarks((previous) => previous.map((bookmark) => upgraded.get(bookmark.id) ?? bookmark));
      setStatus(
        `已复用 ${matched.length} 个检测结果，${bookmarks.length - matched.length} 个未覆盖。报告生成于 ${new Date(report.generatedAt).toLocaleString()}；未重新访问链接。`,
      );
    });
  }

  const currentResults = bookmarks.flatMap((bookmark) =>
    results[bookmark.id] ? [{ ...results[bookmark.id]!, bookmark }] : [],
  );
  function exportReport() {
    const report = createCheckReport(filename, currentResults);
    download(
      new Blob([stringifyCheckReport(report)], { type: "application/json;charset=utf-8" }),
      filename.replace(/\.html?$/i, "") + ".check-report.json",
    );
  }

  function clear() {
    void safely(async () => {
      await persistence.clear();
      setBookmarks([]);
      setOriginal([]);
      setFilename("");
      setTitle("Bookmarks");
      setResults({});
      setReport("");
      setTraceUrl("");
      conversation.reset();
      setStatus("已清空工作台和当前标签页的恢复缓存。");
    });
  }

  return {
    bookmarks,
    conversation,
    setBookmarks,
    original,
    filename,
    results,
    setResults,
    report,
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    hasApiKey,
    configPath,
    traceUrl,
    persistence,
    currentResults,
    busy: loading || Boolean(running) || !persistence.ready,
    running,
    status,
    percent,
    socket,
    importFile,
    run,
    dedupe,
    restore,
    cancel,
    save,
    saveAiConfig,
    importReport,
    exportReport,
    clear,
  };
}
