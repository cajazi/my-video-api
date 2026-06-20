import type { Prisma } from "@prisma/client";
import type { EditJobQueuePayload } from "../../queues/queue.constants";
import { HttpError } from "../../utils/http-error";
import type { CreateEditJobInput } from "./edit-jobs.schemas";
import { toEditJobResponse } from "./edit-jobs.presenter";
import type { EditJobsRepository } from "./edit-jobs.repository";

const NOT_FOUND_MESSAGE = "Resource not found";
const QUEUE_UNAVAILABLE_MESSAGE = "Edit job queue is unavailable";

type EnqueueEditJob = (payload: EditJobQueuePayload) => Promise<unknown>;

export class EditJobsService {
  constructor(
    private readonly repository: EditJobsRepository,
    private readonly enqueueEditJob: EnqueueEditJob,
  ) {}

  async createEditJob(userId: string, input: CreateEditJobInput) {
    const video = await this.repository.findVideoForOwner(input.videoId, userId);

    if (!video) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }

    const editJob = await this.repository.create({
      userId,
      videoId: input.videoId,
      inputConfig: input.inputConfig as Prisma.InputJsonValue,
    });

    try {
      await this.enqueueEditJob({
        editJobId: editJob.id,
        userId: editJob.userId,
        videoId: editJob.videoId,
      });
    } catch (error) {
      await this.repository.deleteByIdForUser(editJob.id, userId);
      throw new HttpError(QUEUE_UNAVAILABLE_MESSAGE, 503);
    }

    return toEditJobResponse(editJob);
  }

  async getEditJob(userId: string, id: string) {
    const editJob = await this.repository.findByIdForUser(id, userId);

    if (!editJob) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }

    return toEditJobResponse(editJob);
  }
}
