import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";

export interface FolderNode {
  key: string;
  title: string;
  children: FolderNode[];
}

export function buildFolderTree(bookmarks: ExtractedBookmark[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const index = new Map<string, FolderNode>();
  for (const bookmark of bookmarks) {
    let children = roots;
    bookmark.folderPath.forEach((title, depth) => {
      const key = JSON.stringify(bookmark.folderPath.slice(0, depth + 1));
      let node = index.get(key);
      if (!node) {
        node = { key, title, children: [] };
        children.push(node);
        index.set(key, node);
      }
      children = node.children;
    });
  }
  return roots;
}

export function inFolder(bookmark: ExtractedBookmark, key: string): boolean {
  if (key === "all") return true;
  if (key === "root") return bookmark.folderPath.length === 0;
  const path = JSON.parse(key) as string[];
  return path.every((segment, index) => bookmark.folderPath[index] === segment);
}
