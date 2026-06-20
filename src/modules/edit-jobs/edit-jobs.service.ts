import type { Prisma } from "@prisma/client";
import { HttpError } from "../../utils/http-error";
import type { CreateEditJobInput } from "./edit-jobs.schemas";
import { toEditJobResponse } from "./edit-jobs.presenter";
import type { EditJobsRepository } from "./edit-jobs.repository";

const NOT_FOUND_MESSAGE = "Resource not found";

export class EditJobsService {
  constructor(private readonly repository: EditJobsRepository) {}

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
