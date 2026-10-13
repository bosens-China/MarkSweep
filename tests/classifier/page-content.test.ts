import { describe, expect, it } from "vitest";
import { extractPageContent } from "@marksweep/core/conversation/page-content";

describe("Markdown page evidence", () => {
  it("preserves headings, lists, code and resolved references while removing chrome", () => {
    const page = extractPageContent(
      `
      <title>教程</title><nav>导航噪音</nav><main>
      <h1>React 教程</h1><p>组件与 <strong>状态</strong></p>
      <ul><li>第一项</li><li>第二项</li></ul>
      <pre><code class="language-ts">const x = 1;\nconsole.log(x);</code></pre>
      <a href="../reference?x=1#section">官方参考</a>
      <a href="https://other.example/guide">其他网站</a>
      <a href="javascript:alert(1)">无效</a><script>危险脚本</script></main>`,
      "https://example.com/docs/article",
    );
    expect(page.contentFormat).toBe("markdown");
    expect(page.content).toContain("# React 教程");
    expect(page.content).toContain("**状态**");
    expect(page.content).toMatch(/[-*] 第一项/);
    expect(page.content).toContain("```");
    expect(page.content).toContain("const x = 1;\nconsole.log(x);");
    expect(page.content).toContain("https://example.com/reference?x=1#section");
    expect(page.content).not.toContain("导航噪音");
    expect(page.content).not.toContain("危险脚本");
    expect(page.links).toEqual([
      { url: "https://example.com/reference?x=1", title: "官方参考" },
      { url: "https://other.example/guide", title: "其他网站" },
    ]);
    expect(page.truncated).toBe(false);
  });
  it("bounds cached content and link lists, and reports empty extraction", () => {
    const page = extractPageContent(
      `<p>${"内容".repeat(9000)}</p>${Array.from({ length: 45 }, (_, i) => `<a href="/${i}">参考</a>`).join("")}`,
      "https://example.com/",
    );
    expect(page.content.length).toBe(16000);
    expect(page.truncated).toBe(true);
    expect(page.links).toHaveLength(40);
    expect(() => extractPageContent("<script>nothing</script>", "https://example.com/")).toThrow("未提取到正文");
  });
});
