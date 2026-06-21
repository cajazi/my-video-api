import { z } from "zod";
import { editSpecV1Schema } from "../edit-specs/edit-spec-v1.schema";

export const editJobIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createEditJobSchema = z.object({
  videoId: z.string().uuid(),
  editSpec: editSpecV1Schema,
});

export type CreateEditJobInput = z.infer<typeof createEditJobSchema>;
