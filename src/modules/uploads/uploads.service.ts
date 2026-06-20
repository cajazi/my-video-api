import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { HttpError } from "../../utils/http-error";
import { VideosRepository } from "../videos/videos.repository";
import { VideosService } from "../videos/videos.service";
import type { CompleteUploadInput, SignUploadInput } from "./uploads.schemas";
import type { UploadsRepository } from "./uploads.repository";
import type { UploadsStorage } from "./uploads.storage";

const NOT_FOUND_MESSAGE = "Resource not found";

export class UploadsService {
  constructor(
    private readonly storage: UploadsStorage,
    private readonly uploadsRepository: UploadsRepository,
    private readonly videosRepository: VideosRepository,
  ) {}

  async signUpload(userId: string, input: SignUploadInput) {
    const storageKey = this.createStorageKey(userId, input.fileName);
    const signedUrl = await this.runStorageOperation(() => this.storage.createSignedUploadUrl(storageKey));

    return {
      storageKey,
      signedUrl,
    };
  }

  async completeUpload(userId: string, input: CompleteUploadInput) {
    this.assertUserStorageKey(userId, input.storageKey);

    const exists = await this.runStorageOperation(() => this.storage.objectExists(input.storageKey));

    if (!exists) {
      throw new HttpError("Uploaded file not found", 404);
    }

    return new VideosService(this.videosRepository).createVideo(userId, {
      originalFileName: input.originalFileName,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationSeconds: input.durationSeconds,
    });
  }

  async createDownloadUrl(userId: string, videoId: string) {
    const video = await this.uploadsRepository.findVideoForDownload(videoId, userId);

    if (!video) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }

    this.assertUserStorageKey(userId, video.storageKey);

    return {
      videoId: video.id,
      signedUrl: await this.runStorageOperation(() => this.storage.createSignedDownloadUrl(video.storageKey)),
    };
  }

  private async runStorageOperation<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch {
      throw new HttpError("Storage operation failed", 502);
    }
  }

  private createStorageKey(userId: string, fileName: string) {
    const extension = extname(fileName).toLowerCase();
    const safeExtension = extension.match(/^\.[a-z0-9]{1,16}$/) ? extension : "";

    return `uploads/${userId}/${randomUUID()}${safeExtension}`;
  }

  private assertUserStorageKey(userId: string, storageKey: string) {
    const expectedPrefix = `uploads/${userId}/`;

    if (!storageKey.startsWith(expectedPrefix) || storageKey.includes("..") || storageKey.endsWith("/")) {
      throw new HttpError(NOT_FOUND_MESSAGE, 404);
    }
  }
}
