import { EditJobStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../utils/http-error";
import { EditJobsService } from "./edit-jobs.service";

const userId = "c6218031-5061-4f49-a9fc-14f7f06798d0";
const videoId = "b5ff818d-5a1c-4bc0-9288-2a05377a8e58";
const editJobId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";

function createRepositoryMock() {
  return {
    findVideoForOwner: vi.fn().mockResolvedValue({ id: videoId }),
    create: vi.fn().mockResolvedValue({
      id: editJobId,
      userId,
      videoId,
      status: EditJobStatus.QUEUED,
      inputConfig: { trim: { start: 5, end: 60 } },
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
      inputConfig: { trim: { start: 5, end: 60 } },
    });

    expect(result.id).toBe(editJobId);
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
        inputConfig: { trim: { start: 5, end: 60 } },
      }),
    ).rejects.toMatchObject<HttpError>({
      message: "Edit job queue is unavailable",
      statusCode: 503,
    });

    expect(repository.deleteByIdForUser).toHaveBeenCalledWith(editJobId, userId);
  });
});
