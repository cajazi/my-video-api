import { z } from "zod";

export const videoIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createVideoSchema = z.object({
  originalFileName: z.string().trim().min(1).max(255),
  storageKey: z.string().trim().min(1).max(1024),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  durationSeconds: z.number().int().nonnegative().max(24 * 60 * 60).optional(),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;
export type VideoIdParams = z.infer<typeof videoIdParamsSchema>;
