import { EditJobStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../utils/http-error";
import { EditJobsService } from "./edit-jobs.service";

const userId = "c6218031-5061-4f49-a9fc-14f7f06798d0";
const videoId = "b5ff818d-5a1c-4bc0-9288-2a05377a8e58";
const editJobId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";
const editSpec = {
  version: "1" as const,
  timeline: {
    tracks: [
      {
        id: "track-1",
        type: "video" as const,
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            videoId,
            positionMs: 0,
            trimStartMs: 5000,
            trimEndMs: 60000,
            durationMs: 55000,
          },
        ],
      },
    ],
  },
};

function createRepositoryMock() {
  return {
    findVideoForOwner: vi.fn().mockResolvedValue({ id: videoId }),
    create: vi.fn().mockResolvedValue({
      id: editJobId,
      userId,
      videoId,
      status: EditJobStatus.QUEUED,
      inputConfig: editSpec,
      outputStorageKey: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
      updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    }),
    deleteByIdForUser: vi.fn().mockResolvedValue({ count: 1 }),
    findByIdForUser: vi.fn(),
  };
}

describe("EditJobsService", () => {
  it("enqueues a newly created edit job", async () => {
    const repository = createRepositoryMock();
    const enqueueEditJob = vi.fn().mockResolvedValue({ id: "bullmq-job-id" });
    const service = new EditJobsService(repository, enqueueEditJob);

    const result = await service.createEditJob(userId, {
      videoId,
      editSpec,
    });

    expect(result.id).toBe(editJobId);
    expect(repository.create).toHaveBeenCalledWith({
      userId,
      videoId,
      inputConfig: editSpec,
    });
    expect(enqueueEditJob).toHaveBeenCalledWith({
      editJobId,
      userId,
      videoId,
    });
    expect(repository.deleteByIdForUser).not.toHaveBeenCalled();
  });

  it("rolls back the edit job and returns 503 when enqueue fails", async () => {
    const repository = createRepositoryMock();
    const enqueueEditJob = vi.fn().mockRejectedValue(new Error("redis unavailable"));
    const service = new EditJobsService(repository, enqueueEditJob);

    await expect(
      service.createEditJob(userId, {
        videoId,
        editSpec,
      }),
    ).rejects.toMatchObject<HttpError>({
      message: "Edit job queue is unavailable",
      statusCode: 503,
    });

    expect(repository.deleteByIdForUser).toHaveBeenCalledWith(editJobId, userId);
  });

  it("adds a signed output download URL for completed jobs", async () => {
    const outputStorageKey = `render-outputs/${userId}/${editJobId}/output.mp4`;
    const repository = createRepositoryMock();
    repository.findByIdForUser.mockResolvedValue({
      id: editJobId,
      userId,
      videoId,
      status: EditJobStatus.COMPLETED,
      inputConfig: editSpec,
      outputStorageKey,
      errorMessage: null,
      startedAt: new Date("2026-06-20T00:00:00.000Z"),
      completedAt: new Date("2026-06-20T00:01:00.000Z"),
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
      updatedAt: new Date("2026-06-20T00:01:00.000Z"),
    });
    const renderedOutputStorage = {
      createSignedDownloadUrl: vi.fn().mockResolvedValue("https://storage.example/signed-output"),
    };
    const service = new EditJobsService(repository, vi.fn(), renderedOutputStorage);

    const result = await service.getEditJob(userId, editJobId);

    expect(renderedOutputStorage.createSignedDownloadUrl).toHaveBeenCalledWith(outputStorageKey);
    expect(result.outputDownloadUrl).toBe("https://storage.example/signed-output");
  });

  it("does not sign output URLs for incomplete jobs", async () => {
    const repository = createRepositoryMock();
    repository.findByIdForUser.mockResolvedValue({
      id: editJobId,
      userId,
      videoId,
      status: EditJobStatus.PROCESSING,
      inputConfig: editSpec,
      outputStorageKey: null,
      errorMessage: null,
      startedAt: new Date("2026-06-20T00:00:00.000Z"),
      completedAt: null,
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
      updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    const renderedOutputStorage = {
      createSignedDownloadUrl: vi.fn(),
    };
    const service = new EditJobsService(repository, vi.fn(), renderedOutputStorage);

    const result = await service.getEditJob(userId, editJobId);

    expect(renderedOutputStorage.createSignedDownloadUrl).not.toHaveBeenCalled();
    expect(result.outputDownloadUrl).toBeNull();
  });
});
