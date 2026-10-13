import { checkBookmarks, summarizeCheckResults } from "@marksweep/core/checker/bookmark-checker";
import { classifyBookmarks } from "@marksweep/core/classifier/bookmark-classifier";
import { auditBookmarks } from "@marksweep/core/classifier/bookmark-auditor";
import { resolveAiConfig, resolveWebPageFetcherConfig } from "@marksweep/core/config/config";
import {
  createLangSmithRuntime,
  resolveLangSmithConfig,
  flushLangSmithRuntime,
  getLangSmithProjectUrl,
} from "@marksweep/core/observability/langsmith";
import { renderBookmarkHtml } from "@marksweep/core/writer/bookmark-html";
import { parseBookmarkHtml, isWebUrl } from "@marksweep/core/parser/bookmark-html";
import type { TaskEvent, TaskRequest } from "@marksweep/core/protocol";
import { organizeBookmarks } from "@marksweep/core/conversation/organizer";
import type { PageCache } from "@marksweep/core/conversation/page-tools";

export interface TaskDependencies {
  checkBookmarks: typeof checkBookmarks;
  classifyBookmarks: typeof classifyBookmarks;
  auditBookmarks: typeof auditBookmarks;
  getLangSmithProjectUrl?: typeof getLangSmithProjectUrl;
  organizeBookmarks?: typeof organizeBookmarks;
}

const defaults: TaskDependencies = { checkBookmarks, classifyBookmarks, auditBookmarks };

export async function runTask(
  request: TaskRequest,
  emit: (event: TaskEvent) => void,
  signal: AbortSignal,
  dependencies: TaskDependencies = defaults,
  pageCache: PageCache = new Map(),
): Promise<void> {
  const { requestId, task, options } = request;
  const bookmarks = request.bookmarks.map((bookmark) => ({ ...bookmark, isWebUrl: isWebUrl(bookmark.url) }));
  signal.throwIfAborted();
  const progress = (message: string) => emit({ type: "progress", requestId, message });
  if (task === "check") {
    const results = await dependencies.checkBookmarks(bookmarks, options, {
      signal,
      onProgress: ({ result, completed, total }) => {
        emit({ type: "check", requestId, result });
        emit({ type: "progress", requestId, message: `已检测 ${completed} / ${total}`, completed, total });
      },
    });
    signal.throwIfAborted();
    emit({ type: "complete", requestId, summary: summarizeCheckResults(results) });
    return;
  }
  const aiConfig = await resolveAiConfig(request.ai, { interactive: false });
  const runtime = createLangSmithRuntime(resolveLangSmithConfig(options), task);
  const traceLink = runtime
    ? (dependencies.getLangSmithProjectUrl ?? getLangSmithProjectUrl)(runtime)
        .then((url) => {
          if (url && URL.canParse(url) && /^https?:\/\//i.test(url)) emit({ type: "trace", requestId, url });
        })
        .catch(() => undefined)
    : Promise.resolve();
  let completion: TaskEvent;
  try {
    const common = {
      signal,
      callbacks: runtime?.callbacks,
      fetcherOptions: { ...resolveWebPageFetcherConfig(), signal },
      onProgress: progress,
    };
    if (task === "organize") {
      if (!request.conversation) throw new Error("缺少对话参数。");
      let sequence = 0;
      const result = await (dependencies.organizeBookmarks ?? organizeBookmarks)(bookmarks, aiConfig, {
        conversation: request.conversation,
        signal: AbortSignal.any([signal, AbortSignal.timeout(options.aiTimeout ?? 600000)]),
        callbacks: runtime?.callbacks,
        maxPages: options.maxPages,
        cache: pageCache,
        emit: (activity) => emit({ type: "activity", requestId, sequence: ++sequence, activity }),
      });
      signal.throwIfAborted();
      completion = { type: "complete", requestId, ...result };
    } else if (task === "classify") {
      const document = await dependencies.classifyBookmarks(bookmarks, aiConfig, { ...common, lang: aiConfig.lang });
      signal.throwIfAborted();
      completion = {
        type: "complete",
        requestId,
        bookmarks: parseBookmarkHtml(renderBookmarkHtml(document)).bookmarks,
      };
    } else {
      const report = await dependencies.auditBookmarks(bookmarks, aiConfig, {
        ...common,
        maxPages: options.maxPages,
        onToken: (token) => emit({ type: "token", requestId, token }),
      });
      signal.throwIfAborted();
      completion = { type: "complete", requestId, report };
    }
  } finally {
    const error = await flushLangSmithRuntime(runtime);
    if (error) emit({ type: "warning", requestId, message: "LangSmith 追踪提交失败，请检查本机配置。" });
    await traceLink;
  }
  signal.throwIfAborted();
  emit(completion);
}
