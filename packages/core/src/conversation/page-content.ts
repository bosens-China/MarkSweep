import { load } from "cheerio";
import { htmlToMarkdown } from "@mdream/js";

export function extractPageContent(html: string, url: string) {
  const $ = load(html);
  const title = $("title").text().trim();
  $("script, style, nav, noscript, svg, form, body > header, body > footer").remove();
  const main = $("article, main, [role=main]").first();
  const root = main.length ? main : $("body");
  const links = new Map<string, string>();
  root.find("a[href]").each((_index, element) => {
    try {
      const target = new URL($(element).attr("href")!, url);
      if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return;
      target.hash = "";
      if (links.size < 40) links.set(target.href, $(element).text().trim().slice(0, 200));
    } catch {
      // 无效链接不影响正文转换。
    }
  });
  const content = htmlToMarkdown(root.html() ?? "", { origin: url }).trim();
  if (!content) throw new Error("未提取到正文，页面可能需要 JavaScript 或登录。");
  return {
    title,
    content: content.slice(0, 16000),
    contentFormat: "markdown" as const,
    truncated: content.length > 16000,
    links: [...links].map(([url, title]) => ({ url, title })),
  };
}
