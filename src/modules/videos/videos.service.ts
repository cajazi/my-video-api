import { Prisma } from "@prisma/client";
import { HttpError } from "../../utils/http-error";
import type { CreateVideoInput } from "./videos.schemas";
import { toVideoResponse } from "./videos.presenter";
import type { VideosRepository } from "./videos.repository";

const NOT_FOUND_MESSAGE = "Resource not found";

export class VideosService {
  constructor(private readonly repository: VideosRepository) {}

  async createVideo(ownerId: string, input: CreateVideoInput) {
    try {
      const video = await this.repository.create({
        ownerId,
        originalFileName: input.originalFileName,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        durationSeconds: input.durationSeconds,
      });

      return toVideoResponse(video);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError("Video storage key already exists", 409);
      }

      throw error;
    }
  }

  async listVideos(ownerId: string) {
    const videos = await this.repository.findManyByOwner(ownerId);
    return videos.map(toVideoResponse);
  }

  async getVideo(ownerId: string, id: string) {
    const video = await this.repository.findByIdForOwner(id, ownerId);

    if (!video) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }

    return toVideoResponse(video);
  }

  async deleteVideo(ownerId: string, id: string) {
    const result = await this.repository.softDelete(id, ownerId);

    if (result.count === 0) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }
  }
}
