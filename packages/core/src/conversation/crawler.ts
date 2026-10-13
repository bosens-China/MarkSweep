import { randomUUID } from "node:crypto";
import { CheerioCrawler, Configuration, RequestQueue } from "@crawlee/cheerio";
import { assertPublicUrl } from "./public-url.js";
import { extractPageContent } from "./page-content.js";

export interface PageEvidence {
  url: string;
  finalUrl?: string;
  title?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
  contentFormat?: "markdown";
  links?: Array<{ url: string; title: string }>;
  timings?: { requestMs: number; conversionMs: number; attempts: number };
}

export async function crawlPages(
  urls: string[],
  signal: AbortSignal,
  onPage: (evidence: PageEvidence) => void,
): Promise<void> {
  signal.throwIfAborted();
  const allowed: string[] = [];
  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      try {
        await assertPublicUrl(url);
        allowed.push(url);
      } catch (error) {
        onPage({ url, error: error instanceof Error ? error.message : "URL 不可采集。" });
      }
    }),
  );
  signal.throwIfAborted();
  if (!allowed.length) return;
  const config = new Configuration({ persistStorage: false, purgeOnStart: false });
  config.set("persistStorage", false);
  const queue = await RequestQueue.open(`marksweep-${randomUUID()}`, { config });
  const started = new Map<string, number>();
  const crawler = new CheerioCrawler(
    {
      requestQueue: queue,
      maxConcurrency: 4,
      maxRequestsPerMinute: 60,
      sameDomainDelaySecs: 1,
      maxRequestRetries: 2,
      useSessionPool: false,
      requestHandlerTimeoutSecs: 20,
      navigationTimeoutSecs: 12,
      respectRobotsTxtFile: true,
      preNavigationHooks: [
        async ({ request }, options) => {
          started.set(request.url, performance.now());
          signal.throwIfAborted();
          await assertPublicUrl(request.url);
          options.signal = signal;
          options.hooks ??= {};
          options.hooks.beforeRedirect ??= [];
          options.hooks.beforeRedirect.push(async (redirect) => {
            await assertPublicUrl(String(redirect.url));
          });
        },
      ],
      async requestHandler({ request, $ }) {
        signal.throwIfAborted();
        const received = performance.now();
        const content = extractPageContent($.html(), request.loadedUrl ?? request.url);
        onPage({
          url: request.url,
          finalUrl: request.loadedUrl,
          ...content,
          timings: {
            requestMs: Math.round(received - (started.get(request.url) ?? received)),
            conversionMs: Math.round(performance.now() - received),
            attempts: request.retryCount + 1,
          },
        });
      },
      async failedRequestHandler({ request }, error) {
        if (!signal.aborted) onPage({ url: request.url, error: error.message.slice(0, 500) });
      },
      onSkippedRequest: ({ url, reason }) => {
        onPage({ url, error: `页面未采集：${reason}` });
      },
    },
    config,
  );
  const abort = () => {
    void crawler.autoscaledPool?.abort().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await crawler.run(allowed);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", abort);
    await queue.drop();
  }
}
