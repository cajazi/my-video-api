import { z } from "zod";

export const signUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
});

export const completeUploadSchema = z.object({
  storageKey: z.string().trim().min(1).max(1024),
  originalFileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  durationSeconds: z.number().int().nonnegative().max(24 * 60 * 60).optional(),
});

export const downloadParamsSchema = z.object({
  videoId: z.string().uuid(),
});

export type SignUploadInput = z.infer<typeof signUploadSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;
