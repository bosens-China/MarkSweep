import type { BookmarkAttributes, ExtractedBookmark } from "../parser/bookmark-html.js";

export interface BookmarkFolderNode {
  title: string;
  attributes?: BookmarkAttributes;
  folders: BookmarkFolderNode[];
  bookmarks: ExtractedBookmark[];
}

export interface BookmarkHtmlDocument {
  title?: string;
  folders: BookmarkFolderNode[];
  bookmarks: ExtractedBookmark[];
}

export function createBookmarkHtmlDocument(
  bookmarks: ExtractedBookmark[],
  options: { title?: string; otherFolderTitle?: string } = {},
): BookmarkHtmlDocument {
  const root: BookmarkHtmlDocument = {
    title: options.title ?? "Bookmarks",
    folders: [],
    bookmarks: [],
  };
  const folderIndex = new Map<string, BookmarkFolderNode>();

  for (const bookmark of bookmarks) {
    if (bookmark.folderPath.length === 0) {
      root.bookmarks.push(bookmark);
      continue;
    }

    let currentFolders = root.folders;
    const currentPath: string[] = [];
    let currentFolder: BookmarkFolderNode | undefined;

    for (const segment of bookmark.folderPath) {
      currentPath.push(segment);
      const key = currentPath.join("\u0000");
      const existing = folderIndex.get(key);

      if (existing) {
        currentFolder = existing;
        currentFolders = existing.folders;
        continue;
      }

      const created: BookmarkFolderNode = {
        title: segment,
        folders: [],
        bookmarks: [],
      };

      folderIndex.set(key, created);
      currentFolders.push(created);
      currentFolder = created;
      currentFolders = created.folders;
    }

    (currentFolder ?? root).bookmarks.push(bookmark);
  }

  return root;
}

export function renderBookmarkHtml(document: BookmarkHtmlDocument): string {
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file.",
    "     It will be read and overwritten.",
    "     DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${escapeText(document.title ?? "Bookmarks")}</TITLE>`,
    `<H1>${escapeText(document.title ?? "Bookmarks")}</H1>`,
    "<DL><p>",
  ];

  for (const folder of document.folders) {
    renderFolder(folder, lines, 1);
  }

  for (const bookmark of document.bookmarks) {
    lines.push(`${indent(1)}${renderBookmark(bookmark)}`);
  }

  lines.push("</DL><p>");
  return `${lines.join("\n")}\n`;
}

export function moveBookmarksToFolder(bookmarks: ExtractedBookmark[], folderTitle: string): ExtractedBookmark[] {
  return bookmarks.map((bookmark) => ({
    ...bookmark,
    folderPath: [folderTitle],
  }));
}

function renderFolder(folder: BookmarkFolderNode, lines: string[], level: number): void {
  lines.push(`${indent(level)}<DT><H3${renderAttributes(folder.attributes ?? {})}>${escapeText(folder.title)}</H3>`);
  lines.push(`${indent(level)}<DL><p>`);

  for (const child of folder.folders) {
    renderFolder(child, lines, level + 1);
  }

  for (const bookmark of folder.bookmarks) {
    lines.push(`${indent(level + 1)}${renderBookmark(bookmark)}`);
  }

  lines.push(`${indent(level)}</DL><p>`);
}

function renderBookmark(bookmark: ExtractedBookmark): string {
  const attributes = {
    ...bookmark.attributes,
    href: bookmark.url,
  };

  return `<DT><A${renderAttributes(attributes)}>${escapeText(bookmark.title)}</A>`;
}

function renderAttributes(attributes: BookmarkAttributes): string {
  const rendered = Object.entries(attributes)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => ` ${formatAttributeName(key)}="${escapeAttribute(value)}"`)
    .join("");

  return rendered;
}

function formatAttributeName(name: string): string {
  return name.replace(/-/g, "_").toUpperCase();
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function indent(level: number): string {
  return "    ".repeat(level);
}
