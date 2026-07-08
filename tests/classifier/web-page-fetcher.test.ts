import { describe, expect, it } from "vitest";
import { createFetchWebPageTool, fetchWebPageContent } from "../../src/classifier/tools/web-page-fetcher";

describe("fetchWebPageContent", () => {
  it("uses Firecrawl first when an API key is available", async () => {
    const result = await fetchWebPageContent("https://example.com", {
      firecrawlApiKey: "fc-test",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            data: {
              markdown: "# Example",
              metadata: {
                title: "Example",
                description: "Demo",
              },
            },
          }),
          { status: 200 },
        ) as never,
    });

    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      description: "Demo",
      content: "# Example",
      source: "firecrawl",
    });
  });

  it("falls back to Jina Reader when Firecrawl is unavailable", async () => {
    let calls = 0;
    const result = await fetchWebPageContent("https://example.com", {
      firecrawlApiKey: "fc-test",
      fetcher: async () => {
        calls += 1;

        if (calls === 1) {
          return new Response("nope", { status: 500 }) as never;
        }

        return new Response("Title: Example\nDescription: Demo\n\nMarkdown body", { status: 200 }) as never;
      },
    });

    expect(result.source).toBe("jina");
    expect(result.title).toBe("Example");
    expect(result.description).toBe("Demo");
    expect(result.content).toContain("Markdown body");
  });

  it("falls back to plain HTML extraction", async () => {
    let calls = 0;
    const result = await fetchWebPageContent("https://example.com", {
      fetcher: async () => {
        calls += 1;

        if (calls === 1) {
          return new Response("nope", { status: 500 }) as never;
        }

        return new Response(
          '<html><head><title>SSR Page</title><meta name="description" content="Desc"></head><body><script>bad()</script><main>Hello world</main></body></html>',
          { status: 200 },
        ) as never;
      },
    });

    expect(result).toMatchObject({
      source: "html",
      title: "SSR Page",
      description: "Desc",
      content: "Hello world",
    });
  });

  it("times out slow providers and falls back to the next source", async () => {
    let calls = 0;
    const result = await fetchWebPageContent("https://example.com", {
      timeoutMs: 5,
      fetcher: async () => {
        calls += 1;

        if (calls === 1) {
          await delay(50);
          return new Response("late", { status: 200 }) as never;
        }

        return new Response("<html><head><title>Fallback</title></head><body>Fallback body</body></html>", {
          status: 200,
        }) as never;
      },
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({
      source: "html",
      title: "Fallback",
      content: "Fallback body",
    });
  });
});

describe("createFetchWebPageTool", () => {
  it("creates an agent-callable LangChain tool", async () => {
    const fetchWebPage = createFetchWebPageTool({
      fetcher: async () => new Response("Title: Example\n\nBody", { status: 200 }) as never,
    });

    expect(fetchWebPage.name).toBe("fetch_web_page");
    await expect(fetchWebPage.invoke({ url: "https://example.com" })).resolves.toContain('"source":"jina"');
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
