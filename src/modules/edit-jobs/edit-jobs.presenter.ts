import type { EditJobResponse, EditJobRecord } from "./edit-jobs.types";

export function toEditJobResponse(editJob: EditJobRecord): EditJobResponse {
  return {
    id: editJob.id,
    userId: editJob.userId,
    videoId: editJob.videoId,
    status: editJob.status,
    inputConfig: editJob.inputConfig,
    outputStorageKey: editJob.outputStorageKey,
    errorMessage: editJob.errorMessage,
    startedAt: editJob.startedAt,
    completedAt: editJob.completedAt,
    createdAt: editJob.createdAt,
    updatedAt: editJob.updatedAt,
  };
}
