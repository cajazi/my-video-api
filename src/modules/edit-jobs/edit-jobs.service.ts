import type { Prisma } from "@prisma/client";
import { EditJobStatus } from "@prisma/client";
import type { EditJobQueuePayload } from "../../queues/queue.constants";
import { HttpError } from "../../utils/http-error";
import { getFirstVideoClip } from "../edit-specs/edit-spec-v1.schema";
import type { CreateEditJobInput } from "./edit-jobs.schemas";
import { toEditJobResponse } from "./edit-jobs.presenter";
import type { EditJobsRepository } from "./edit-jobs.repository";

const NOT_FOUND_MESSAGE = "Resource not found";
const QUEUE_UNAVAILABLE_MESSAGE = "Edit job queue is unavailable";
const CLIP_VIDEO_MISMATCH_MESSAGE = "Edit spec clip videoId must match the edit job videoId";

type EnqueueEditJob = (payload: EditJobQueuePayload) => Promise<unknown>;
type RenderedOutputStorage = {
  createSignedDownloadUrl(storageKey: string): Promise<string>;
};

export class EditJobsService {
  constructor(
    private readonly repository: EditJobsRepository,
    private readonly enqueueEditJob: EnqueueEditJob,
    private readonly renderedOutputStorage?: RenderedOutputStorage,
  ) {}

  async createEditJob(userId: string, input: CreateEditJobInput) {
    const firstClip = getFirstVideoClip(input.editSpec);

    if (firstClip.videoId !== input.videoId) {
      throw new HttpError(CLIP_VIDEO_MISMATCH_MESSAGE, 400);
    }

    const video = await this.repository.findVideoForOwner(input.videoId, userId);

    if (!video) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }

    const editJob = await this.repository.create({
      userId,
      videoId: input.videoId,
      inputConfig: input.editSpec as Prisma.InputJsonValue,
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

    return toEditJobResponse(editJob, null);
  }

  async getEditJob(userId: string, id: string) {
    const editJob = await this.repository.findByIdForUser(id, userId);

    if (!editJob) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }

    const outputDownloadUrl =
      editJob.status === EditJobStatus.COMPLETED && editJob.outputStorageKey
        ? await this.createOutputDownloadUrl(editJob.outputStorageKey)
        : null;

    return toEditJobResponse(editJob, outputDownloadUrl);
  }

  private async createOutputDownloadUrl(outputStorageKey: string) {
    if (!this.renderedOutputStorage) {
      return null;
    }

    try {
      return await this.renderedOutputStorage.createSignedDownloadUrl(outputStorageKey);
    } catch {
      throw new HttpError("Storage operation failed", 502);
    }
  }
}
