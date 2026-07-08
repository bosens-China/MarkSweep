import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

type CheerioSelection = ReturnType<CheerioAPI>;

export type BookmarkAttributes = Record<string, string>;

export interface ExtractedBookmark {
  id: string;
  title: string;
  url: string;
  folderPath: string[];
  attributes: BookmarkAttributes;
  isWebUrl: boolean;
}

export interface ExtractedFolder {
  id: string;
  title: string;
  path: string[];
  attributes: BookmarkAttributes;
}

export interface ParsedBookmarkHtml {
  rootTitle: string;
  bookmarks: ExtractedBookmark[];
  folders: ExtractedFolder[];
}

interface ParseState {
  bookmarks: ExtractedBookmark[];
  folders: ExtractedFolder[];
}

export function parseBookmarkHtml(html: string): ParsedBookmarkHtml {
  const $ = cheerio.load(html);
  const rootTitle = normalizeText($("h1").first().text()) || "Bookmarks";
  const rootDl = $("body > dl").first().length > 0 ? $("body > dl").first() : $("dl").first();
  const state: ParseState = {
    bookmarks: [],
    folders: [],
  };

  if (rootDl.length === 0) {
    throw new Error("未找到浏览器书签 HTML 的 <DL> 根节点");
  }

  walkBookmarkList($, rootDl, [], state);

  return {
    rootTitle,
    bookmarks: state.bookmarks,
    folders: state.folders,
  };
}

export function extractBookmarks(html: string): ExtractedBookmark[] {
  return parseBookmarkHtml(html).bookmarks;
}

export function extractFolders(html: string): ExtractedFolder[] {
  return parseBookmarkHtml(html).folders;
}

export function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function walkBookmarkList($: CheerioAPI, dl: CheerioSelection, folderPath: string[], state: ParseState): void {
  dl.children("dt").each((_, dt) => {
    const item = $(dt);
    const anchor = item.children("a[href]").first();

    if (anchor.length > 0) {
      state.bookmarks.push(createBookmark(anchor, folderPath, state.bookmarks.length));
      return;
    }

    const heading = item.children("h3").first();
    if (heading.length === 0) {
      return;
    }

    const title = normalizeText(heading.text());
    const nextPath = title ? [...folderPath, title] : [...folderPath];

    if (title) {
      state.folders.push({
        id: createStableId("folder", `${nextPath.join("\u0000")}\u0000${state.folders.length}`),
        title,
        path: nextPath,
        attributes: getAttributes(heading),
      });
    }

    const childList = item.children("dl").first();
    if (childList.length > 0) {
      walkBookmarkList($, childList, nextPath, state);
    }
  });
}

function createBookmark(anchor: CheerioSelection, folderPath: string[], index: number): ExtractedBookmark {
  const attributes = getAttributes(anchor);
  const url = attributes.href ?? "";
  const title = normalizeText(anchor.text());

  return {
    id: createStableId("bookmark", `${url}\u0000${title}\u0000${folderPath.join("\u0000")}\u0000${index}`),
    title,
    url,
    folderPath: [...folderPath],
    attributes,
    isWebUrl: isWebUrl(url),
  };
}

function getAttributes(element: CheerioSelection): BookmarkAttributes {
  const attributes = element.attr() ?? {};
  return Object.fromEntries(
    Object.entries(attributes).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createStableId(prefix: string, value: string): string {
  const hash = createHash("sha1").update(value).digest("hex").slice(0, 12);
  return `${prefix}_${hash}`;
}
