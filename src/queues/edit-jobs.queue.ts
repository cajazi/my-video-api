import { Queue, type ConnectionOptions } from "bullmq";
import { redisConnection } from "../config/redis";
import {
  EDIT_JOB_PROCESS_NAME,
  EDIT_JOBS_QUEUE_NAME,
  editJobQueuePayloadSchema,
  type EditJobQueuePayload,
} from "./queue.constants";

export const editJobsQueue = new Queue<EditJobQueuePayload, unknown, typeof EDIT_JOB_PROCESS_NAME>(EDIT_JOBS_QUEUE_NAME, {
  connection: redisConnection as unknown as ConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

export async function enqueueEditJob(payload: EditJobQueuePayload) {
  const validatedPayload = editJobQueuePayloadSchema.parse(payload);

  return editJobsQueue.add(EDIT_JOB_PROCESS_NAME, validatedPayload);
}
