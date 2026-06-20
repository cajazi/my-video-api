import { z } from "zod";

export const EDIT_JOBS_QUEUE_NAME = "edit-jobs";
export const EDIT_JOB_PROCESS_NAME = "process-edit-job";

export const editJobQueuePayloadSchema = z.object({
  editJobId: z.string().uuid(),
  userId: z.string().uuid(),
  videoId: z.string().uuid(),
});

export type EditJobQueuePayload = z.infer<typeof editJobQueuePayloadSchema>;
