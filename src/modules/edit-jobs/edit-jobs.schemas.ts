import { z } from "zod";

export const editJobIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createEditJobSchema = z.object({
  videoId: z.string().uuid(),
  inputConfig: z.record(z.string(), z.unknown()),
});

export type CreateEditJobInput = z.infer<typeof createEditJobSchema>;
