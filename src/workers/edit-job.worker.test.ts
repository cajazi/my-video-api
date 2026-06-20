import { EditJobStatus } from "@prisma/client";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import type { EditJobQueuePayload } from "../queues/queue.constants";
import { processEditJob } from "./edit-job.worker";

const validPayload = {
  editJobId: "0f6979d0-4db1-49f7-b99f-6f5b6f706286",
  userId: "c6218031-5061-4f49-a9fc-14f7f06798d0",
  videoId: "b5ff818d-5a1c-4bc0-9288-2a05377a8e58",
};

function createJob(data: unknown): Job<EditJobQueuePayload> {
  return {
    id: "bull-job-id",
    data,
  } as Job<EditJobQueuePayload>;
}

function createDependencies(overrides: { delay?: () => Promise<void> } = {}) {
  return {
    prisma: {
      editJob: {
        update: vi.fn().mockResolvedValue({}),
      },
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    delay: overrides.delay ?? vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => new Date("2026-06-20T00:00:00.000Z")),
  };
}

describe("processEditJob", () => {
  it("rejects invalid payloads before processing", async () => {
    const dependencies = createDependencies();

    await expect(
      processEditJob(
        createJob({
          ...validPayload,
          editJobId: "not-a-uuid",
        }),
        dependencies,
      ),
    ).rejects.toThrow();

    expect(dependencies.prisma.editJob.update).not.toHaveBeenCalled();
  });

  it("transitions an edit job from PROCESSING to COMPLETED", async () => {
    const dependencies = createDependencies();

    await processEditJob(createJob(validPayload), dependencies);

    expect(dependencies.prisma.editJob.update).toHaveBeenNthCalledWith(1, {
      where: {
        id: validPayload.editJobId,
      },
      data: {
        status: EditJobStatus.PROCESSING,
        startedAt: new Date("2026-06-20T00:00:00.000Z"),
        completedAt: null,
        errorMessage: null,
      },
    });
    expect(dependencies.prisma.editJob.update).toHaveBeenNthCalledWith(2, {
      where: {
        id: validPayload.editJobId,
      },
      data: {
        status: EditJobStatus.COMPLETED,
        completedAt: new Date("2026-06-20T00:00:00.000Z"),
        errorMessage: null,
      },
    });
    expect(dependencies.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "edit_job.job_started",
        editJobId: validPayload.editJobId,
      }),
    );
    expect(dependencies.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "edit_job.job_completed",
        editJobId: validPayload.editJobId,
      }),
    );
  });

  it("transitions an edit job to FAILED and rethrows processing errors", async () => {
    const processingError = new Error("simulated failure");
    const dependencies = createDependencies({
      delay: vi.fn().mockRejectedValue(processingError),
    });

    await expect(processEditJob(createJob(validPayload), dependencies)).rejects.toThrow("simulated failure");

    expect(dependencies.prisma.editJob.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: validPayload.editJobId,
        },
        data: {
          status: EditJobStatus.FAILED,
          completedAt: new Date("2026-06-20T00:00:00.000Z"),
          errorMessage: "simulated failure",
        },
      }),
    );
    expect(dependencies.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "edit_job.job_failed",
        editJobId: validPayload.editJobId,
        errorMessage: "simulated failure",
      }),
    );
  });
});
