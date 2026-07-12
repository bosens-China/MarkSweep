import { z } from "zod";

export interface ClassifiedFolder {
  title: string;
  bookmarks: number[];
  children: ClassifiedFolder[];
}

export interface BookmarkClassification {
  folders: ClassifiedFolder[];
}

export const ClassifiedFolderSchema: z.ZodType<ClassifiedFolder> = z.lazy(() =>
  z.object({
    title: z.string().min(1),
    bookmarks: z.array(z.number().int().positive()).default([]),
    children: z.array(ClassifiedFolderSchema).default([]),
  }),
);

export const BookmarkClassificationSchema = z
  .object({
    folders: z.array(ClassifiedFolderSchema).min(1),
  })
  .meta({
    title: "submit_bookmark_classification",
    description: "书签分类完成后，必须调用此工具提交最终目录结构。",
  });
