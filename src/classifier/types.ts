import { z } from "zod";

export interface ClassifiedFolder {
  title: string;
  bookmarks: string[];
  children: ClassifiedFolder[];
}

export interface BookmarkClassification {
  folders: ClassifiedFolder[];
}

export const ClassifiedFolderSchema: z.ZodType<ClassifiedFolder> = z.lazy(() =>
  z.object({
    title: z.string().min(1),
    bookmarks: z.array(z.string()).default([]),
    children: z.array(ClassifiedFolderSchema).default([]),
  }),
);

export const BookmarkClassificationSchema = z.object({
  folders: z.array(ClassifiedFolderSchema).min(1),
});
