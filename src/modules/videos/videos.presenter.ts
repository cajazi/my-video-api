import type { VideoRecord, VideoResponse } from "./videos.types";

export function toVideoResponse(video: VideoRecord): VideoResponse {
  return {
    id: video.id,
    ownerId: video.ownerId,
    originalFileName: video.originalFileName,
    storageKey: video.storageKey,
    mimeType: video.mimeType,
    sizeBytes: Number(video.sizeBytes),
    durationSeconds: video.durationSeconds,
    status: video.status,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
}
