import { z } from "zod";

export const conversationInputSchema = z.object({
  id: z.string().uuid(),
  instruction: z.string().trim().max(6000).default(""),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12000) }))
    .max(80)
    .default([]),
});

export const organizationSchema = z.object({
  mode: z.enum(["complete", "patch"]).optional(),
  summary: z.string().min(1).max(12000),
  assignments: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().trim().min(1).max(10000).optional(),
        folderPath: z.array(z.string().trim().min(1).max(1000)).max(20),
        reason: z.string().max(2000),
      }),
    )
    .max(50000),
});

export const activitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), id: z.string(), text: z.string() }),
  z.object({ kind: z.literal("message"), id: z.string(), channel: z.enum(["text", "reasoning"]), text: z.string() }),
  z.object({
    kind: z.literal("tool"),
    id: z.string(),
    name: z.string(),
    status: z.enum(["running", "complete", "error"]),
    text: z.string(),
    elapsedMs: z.number().nonnegative().optional(),
    url: z.string().optional(),
    sourceUrl: z.string().optional(),
  }),
  z.object({
    kind: z.literal("timing"),
    id: z.string(),
    name: z.string(),
    phase: z.enum(["model", "total"]),
    status: z.enum(["running", "complete", "error"]),
    elapsedMs: z.number().nonnegative(),
    firstTokenMs: z.number().nonnegative().optional(),
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
  }),
]);
export type ConversationInput = z.infer<typeof conversationInputSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type AgentActivity = z.infer<typeof activitySchema>;
