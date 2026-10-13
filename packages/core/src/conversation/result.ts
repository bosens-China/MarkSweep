import type { ExtractedBookmark } from "../parser/bookmark-html.js";
import { organizationSchema, type Organization } from "./schema.js";

export function applyOrganization(
  bookmarks: ExtractedBookmark[],
  value: unknown,
): {
  bookmarks: ExtractedBookmark[];
  organization: Organization;
} {
  const organization = organizationSchema.parse(value);
  const assignments = new Map(organization.assignments.map((item) => [item.id, item]));
  const ids = new Set(bookmarks.map((bookmark) => bookmark.id));
  if (
    assignments.size !== organization.assignments.length ||
    organization.assignments.some((item) => !ids.has(item.id)) ||
    (organization.mode !== "patch" &&
      (assignments.size !== bookmarks.length || bookmarks.some((bookmark) => !assignments.has(bookmark.id))))
  ) {
    throw new Error("整理结果必须恰好包含每一个输入书签，不能遗漏、重复或添加书签。");
  }
  return {
    organization,
    bookmarks: bookmarks.map((bookmark) => {
      const assignment = assignments.get(bookmark.id);
      return assignment
        ? { ...bookmark, title: assignment.title ?? bookmark.title, folderPath: [...assignment.folderPath] }
        : bookmark;
    }),
  };
}
