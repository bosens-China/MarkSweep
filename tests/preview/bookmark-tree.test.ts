import { describe, expect, it } from "vitest";
import { renderBookmarkTreePreview } from "../../src/preview/bookmark-tree";
import type { ExtractedBookmark } from "../../src/parser/bookmark-html";

describe("bookmark tree preview", () => {
  it("renders every bookmark in its nested folder", () => {
    const html = renderBookmarkTreePreview({
      title: "分类预览",
      folders: [
        {
          title: "AI",
          bookmarks: [bookmark("LLM", "https://example.com/llm")],
          folders: [
            {
              title: "Agents",
              bookmarks: [bookmark("Agent <Guide>", "https://example.com/agent?a=1&b=2")],
              folders: [],
            },
          ],
        },
      ],
      bookmarks: [bookmark("Root", "https://example.com")],
    });

    expect(html).toContain('data-depth="1" open');
    expect(html).toContain('data-depth="2"');
    expect(html).not.toContain('data-depth="2" open');
    expect(html).toContain('details[data-depth="2"] { margin-left: 44px');
    expect(html).toContain('details[data-depth="3"] { margin-left: 52px');
    expect(html).toContain("共 3 个书签 · 1 个一级目录");
    expect(html).toContain('<summary>AI<small class="count">2 个</small></summary>');
    expect(html).toContain('data-action="expand">一键展开');
    expect(html).toContain('data-action="collapse">一键收起');
    expect(html).toContain('type="search" placeholder="搜索标题或 URL"');
    expect(html).toContain('getAttribute("href")');
    expect(html).toContain("folder.open = query ? matched");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html.indexOf(">LLM</a>")).toBeLessThan(html.indexOf("<summary>Agents<"));
    expect(html).toContain("Agent &lt;Guide&gt;");
    expect(html).toContain("https://example.com/agent?a=1&amp;b=2");
    expect(html.match(/<li>/g)).toHaveLength(3);
  });
});

function bookmark(title: string, url: string): ExtractedBookmark {
  return {
    id: url,
    title,
    url,
    folderPath: [],
    attributes: {},
    isWebUrl: true,
  };
}
