import { EditJobStatus } from "@prisma/client";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { FFmpegRenderer } from "../modules/rendering/ffmpeg.renderer";
import { RenderingService } from "../modules/rendering/rendering.service";
import { createRenderOutputStorageKey } from "../modules/storage/media-storage.paths";
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

const outputStorageKey = createRenderOutputStorageKey(validPayload);
const localOutputPath = "C:\\tmp\\jobs\\0f6979d0-4db1-49f7-b99f-6f5b6f706286\\output.mp4";
const exportSettings = {
  resolutionPreset: "1080p",
  width: 1080,
  height: 1920,
  aspectRatio: "9:16",
  fps: 60,
  backgroundFillColor: "#223344",
} as const;
const editSpec = {
  version: "1",
  timeline: {
    exportSettings,
    tracks: [
      {
        id: "track-1",
        type: "video",
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            videoId: validPayload.videoId,
            positionMs: 0,
            trimStartMs: 1500,
            trimEndMs: 4000,
            durationMs: 2500,
          },
          {
            id: "clip-2",
            assetId: "asset-2",
            videoId: validPayload.videoId,
            positionMs: 4000,
            trimStartMs: 8000,
            trimEndMs: 9000,
            durationMs: 1000,
          },
        ],
      },
    ],
  },
};

function createDependencies(
  overrides: {
    renderEditJob?: () => Promise<{ outputStorageKey: string; localOutputPath: string; durationMs: number }>;
    uploadRenderedOutput?: () => Promise<{ storageKey: string }>;
  } = {},
) {
  return {
    prisma: {
      editJob: {
        update: vi.fn().mockResolvedValue({}),
      },
    },
    renderingService: {
      renderEditJob:
        overrides.renderEditJob ??
        vi.fn().mockResolvedValue({
          outputStorageKey,
          localOutputPath,
          durationMs: 1000,
        }),
    },
    renderedOutputStorage: {
      uploadRenderedOutput:
        overrides.uploadRenderedOutput ??
        vi.fn().mockResolvedValue({
          storageKey: outputStorageKey,
        }),
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    now: vi.fn(() => new Date("2026-06-20T00:00:00.000Z")),
    cleanupWorkspace: vi.fn().mockResolvedValue(undefined),
  };
}

function createFfmpegRenderingService(inputConfig: unknown, executeFfmpeg: (args: string[]) => Promise<void>) {
  const renderer = new FFmpegRenderer({
    localTestVideoPath: "C:\\tmp\\source.mp4",
    checkAvailability: vi.fn().mockResolvedValue(true),
    createWorkspace: vi.fn().mockResolvedValue(undefined),
    writeConcatList: vi.fn().mockResolvedValue(undefined),
    executeFfmpeg,
    now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1250),
  });

  return new RenderingService(
    {
      editJob: {
        findUnique: vi.fn().mockResolvedValue({
          id: validPayload.editJobId,
          userId: validPayload.userId,
          videoId: validPayload.videoId,
          inputConfig,
        }),
      },
      video: {
        findUnique: vi.fn().mockResolvedValue({
          id: validPayload.videoId,
          ownerId: validPayload.userId,
          storageKey: "source-media/user/source.mp4",
        }),
      },
    },
    renderer,
  );
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
    expect(dependencies.renderingService.renderEditJob).not.toHaveBeenCalled();
  });

  it("uploads rendered output, transitions an edit job from PROCESSING to COMPLETED, and stores outputStorageKey", async () => {
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
        outputStorageKey,
        completedAt: new Date("2026-06-20T00:00:00.000Z"),
        errorMessage: null,
      },
    });
    expect(dependencies.renderingService.renderEditJob).toHaveBeenCalledWith(validPayload.editJobId);
    expect(dependencies.renderedOutputStorage.uploadRenderedOutput).toHaveBeenCalledWith({
      localOutputPath,
      storageKey: outputStorageKey,
    });
    expect(dependencies.cleanupWorkspace).toHaveBeenCalledWith(validPayload.editJobId);
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
      renderEditJob: vi.fn().mockRejectedValue(processingError),
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
    expect(dependencies.cleanupWorkspace).toHaveBeenCalledWith(validPayload.editJobId);
  });

  it("marks the edit job FAILED when rendered output upload fails", async () => {
    const uploadError = new Error("storage unavailable");
    const dependencies = createDependencies({
      uploadRenderedOutput: vi.fn().mockRejectedValue(uploadError),
    });

    await expect(processEditJob(createJob(validPayload), dependencies)).rejects.toThrow("storage unavailable");

    expect(dependencies.prisma.editJob.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: validPayload.editJobId,
        },
        data: {
          status: EditJobStatus.FAILED,
          completedAt: new Date("2026-06-20T00:00:00.000Z"),
          errorMessage: "storage unavailable",
        },
      }),
    );
    expect(dependencies.cleanupWorkspace).toHaveBeenCalledWith(validPayload.editJobId);
  });

  it("processes a V1 edit spec with a timeline gap through the FFmpeg render path", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath: "C:\\tmp\\source.mp4",
      checkAvailability: vi.fn().mockResolvedValue(true),
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      executeFfmpeg,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1250),
    });
    const renderingService = new RenderingService(
      {
        editJob: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.editJobId,
            userId: validPayload.userId,
            videoId: validPayload.videoId,
            inputConfig: editSpec,
          }),
        },
        video: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.videoId,
            ownerId: validPayload.userId,
            storageKey: "source-media/user/source.mp4",
          }),
        },
      },
      renderer,
    );
    const dependencies = createDependencies({
      renderEditJob: renderingService.renderEditJob.bind(renderingService),
    });

    await processEditJob(createJob(validPayload), dependencies);

    expect(executeFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["-ss", "1.5", "-to", "4"]));
    expect(executeFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining(["-i", "color=c=0x223344:s=1080x1920:r=60:d=1.5"]),
    );
    expect(executeFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["-ss", "8", "-to", "9"]));
    expect(dependencies.renderedOutputStorage.uploadRenderedOutput).toHaveBeenCalledWith({
      localOutputPath: expect.stringMatching(/tmp[\\/]jobs[\\/]0f6979d0-4db1-49f7-b99f-6f5b6f706286[\\/]output.mp4$/),
      storageKey: outputStorageKey,
    });
  });

  it("processes a V1 edit spec with a dissolve transition through the FFmpeg render path", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath: "C:\\tmp\\source.mp4",
      checkAvailability: vi.fn().mockResolvedValue(true),
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      executeFfmpeg,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1250),
    });
    const renderingService = new RenderingService(
      {
        editJob: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.editJobId,
            userId: validPayload.userId,
            videoId: validPayload.videoId,
            inputConfig: {
              ...editSpec,
              timeline: {
                ...editSpec.timeline,
                tracks: [
                  {
                    id: "track-1",
                    type: "video",
                    clips: [
                      {
                        id: "clip-1",
                        assetId: "asset-1",
                        videoId: validPayload.videoId,
                        positionMs: 0,
                        trimStartMs: 0,
                        trimEndMs: 2000,
                        durationMs: 2000,
                      },
                      {
                        id: "clip-2",
                        assetId: "asset-2",
                        videoId: validPayload.videoId,
                        positionMs: 2000,
                        trimStartMs: 5000,
                        trimEndMs: 7000,
                        durationMs: 2000,
                      },
                    ],
                  },
                ],
                transitions: [
                  {
                    id: "transition-1",
                    type: "dissolve",
                    fromClipId: "clip-1",
                    toClipId: "clip-2",
                    durationMs: 500,
                  },
                ],
              },
            },
          }),
        },
        video: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.videoId,
            ownerId: validPayload.userId,
            storageKey: "source-media/user/source.mp4",
          }),
        },
      },
      renderer,
    );
    const dependencies = createDependencies({
      renderEditJob: renderingService.renderEditJob.bind(renderingService),
    });

    await processEditJob(createJob(validPayload), dependencies);

    expect(executeFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["-ss", "0", "-to", "2"]));
    expect(executeFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["-ss", "5", "-to", "7"]));
    expect(executeFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining([
        "-filter_complex",
        "[0:v]scale=1080:1920,fps=60,format=yuv420p[v0];[1:v]scale=1080:1920,fps=60,format=yuv420p[v1];[v0][v1]xfade=transition=fade:duration=0.5:offset=1.5[v]",
      ]),
    );
    expect(executeFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["-f", "concat"]));
    expect(dependencies.renderedOutputStorage.uploadRenderedOutput).toHaveBeenCalled();
  });

  it("processes a V1 edit spec with chained dissolve transitions through the FFmpeg render path", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath: "C:\\tmp\\source.mp4",
      checkAvailability: vi.fn().mockResolvedValue(true),
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      executeFfmpeg,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1250),
    });
    const renderingService = new RenderingService(
      {
        editJob: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.editJobId,
            userId: validPayload.userId,
            videoId: validPayload.videoId,
            inputConfig: {
              ...editSpec,
              timeline: {
                ...editSpec.timeline,
                tracks: [
                  {
                    id: "track-1",
                    type: "video",
                    clips: [
                      {
                        id: "clip-1",
                        assetId: "asset-1",
                        videoId: validPayload.videoId,
                        positionMs: 0,
                        trimStartMs: 0,
                        trimEndMs: 3000,
                        durationMs: 3000,
                      },
                      {
                        id: "clip-2",
                        assetId: "asset-2",
                        videoId: validPayload.videoId,
                        positionMs: 3000,
                        trimStartMs: 5000,
                        trimEndMs: 9000,
                        durationMs: 4000,
                      },
                      {
                        id: "clip-3",
                        assetId: "asset-3",
                        videoId: validPayload.videoId,
                        positionMs: 7000,
                        trimStartMs: 12000,
                        trimEndMs: 14000,
                        durationMs: 2000,
                      },
                    ],
                  },
                ],
                transitions: [
                  {
                    id: "transition-1",
                    type: "dissolve",
                    fromClipId: "clip-1",
                    toClipId: "clip-2",
                    durationMs: 1000,
                  },
                  {
                    id: "transition-2",
                    type: "dissolve",
                    fromClipId: "clip-2",
                    toClipId: "clip-3",
                    durationMs: 500,
                  },
                ],
              },
            },
          }),
        },
        video: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.videoId,
            ownerId: validPayload.userId,
            storageKey: "source-media/user/source.mp4",
          }),
        },
      },
      renderer,
    );
    const dependencies = createDependencies({
      renderEditJob: renderingService.renderEditJob.bind(renderingService),
    });

    await processEditJob(createJob(validPayload), dependencies);

    expect(executeFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining([
        "-filter_complex",
        "[0:v]scale=1080:1920,fps=60,format=yuv420p[v0];[1:v]scale=1080:1920,fps=60,format=yuv420p[v1];[2:v]scale=1080:1920,fps=60,format=yuv420p[v2];[v0][v1]xfade=transition=fade:duration=1:offset=2[x1];[x1][v2]xfade=transition=fade:duration=0.5:offset=5.5[v]",
      ]),
    );
    expect(dependencies.renderedOutputStorage.uploadRenderedOutput).toHaveBeenCalled();
  });

  it("processes a V1 edit spec with a dip_to_black transition through the FFmpeg render path", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderingService = createFfmpegRenderingService(
      {
        ...editSpec,
        timeline: {
          ...editSpec.timeline,
          tracks: [
            {
              id: "track-1",
              type: "video",
              clips: [
                {
                  id: "clip-1",
                  assetId: "asset-1",
                  videoId: validPayload.videoId,
                  positionMs: 0,
                  trimStartMs: 0,
                  trimEndMs: 2000,
                  durationMs: 2000,
                },
                {
                  id: "clip-2",
                  assetId: "asset-2",
                  videoId: validPayload.videoId,
                  positionMs: 2000,
                  trimStartMs: 5000,
                  trimEndMs: 7000,
                  durationMs: 2000,
                },
              ],
            },
          ],
          transitions: [
            {
              id: "transition-1",
              type: "dip_to_black",
              fromClipId: "clip-1",
              toClipId: "clip-2",
              durationMs: 500,
            },
          ],
        },
      },
      executeFfmpeg,
    );
    const dependencies = createDependencies({
      renderEditJob: renderingService.renderEditJob.bind(renderingService),
    });

    await processEditJob(createJob(validPayload), dependencies);

    expect(executeFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["color=c=0x000000:s=1080x1920:r=60:d=0.25"]));
    expect(executeFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining([
        "-filter_complex",
        expect.stringContaining("[outtail][colorout]xfade=transition=fade:duration=0.25:offset=0[outfade]"),
      ]),
    );
    expect(dependencies.renderedOutputStorage.uploadRenderedOutput).toHaveBeenCalled();
  });

  it("processes a V1 edit spec with a dip_to_white transition through the FFmpeg render path", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderingService = createFfmpegRenderingService(
      {
        ...editSpec,
        timeline: {
          ...editSpec.timeline,
          tracks: [
            {
              id: "track-1",
              type: "video",
              clips: [
                {
                  id: "clip-1",
                  assetId: "asset-1",
                  videoId: validPayload.videoId,
                  positionMs: 0,
                  trimStartMs: 0,
                  trimEndMs: 3000,
                  durationMs: 3000,
                },
                {
                  id: "clip-2",
                  assetId: "asset-2",
                  videoId: validPayload.videoId,
                  positionMs: 3000,
                  trimStartMs: 5000,
                  trimEndMs: 8000,
                  durationMs: 3000,
                },
              ],
            },
          ],
          transitions: [
            {
              id: "transition-1",
              type: "dip_to_white",
              fromClipId: "clip-1",
              toClipId: "clip-2",
              durationMs: 1000,
            },
          ],
        },
      },
      executeFfmpeg,
    );
    const dependencies = createDependencies({
      renderEditJob: renderingService.renderEditJob.bind(renderingService),
    });

    await processEditJob(createJob(validPayload), dependencies);

    expect(executeFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["color=c=0xFFFFFF:s=1080x1920:r=60:d=0.5"]));
    expect(executeFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining([
        "-filter_complex",
        expect.stringContaining("[colorin][intail]xfade=transition=fade:duration=0.5:offset=0[infade]"),
      ]),
    );
    expect(dependencies.renderedOutputStorage.uploadRenderedOutput).toHaveBeenCalled();
  });

  it("marks the job failed before rendering when stored export settings are invalid", async () => {
    const renderer = {
      render: vi.fn(),
    };
    const renderingService = new RenderingService(
      {
        editJob: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.editJobId,
            userId: validPayload.userId,
            videoId: validPayload.videoId,
            inputConfig: {
              ...editSpec,
              timeline: {
                ...editSpec.timeline,
                exportSettings: {
                  ...exportSettings,
                  width: 1079,
                },
              },
            },
          }),
        },
        video: {
          findUnique: vi.fn().mockResolvedValue({
            id: validPayload.videoId,
            ownerId: validPayload.userId,
            storageKey: "source-media/user/source.mp4",
          }),
        },
      },
      renderer,
    );
    const dependencies = createDependencies({
      renderEditJob: renderingService.renderEditJob.bind(renderingService),
    });

    await expect(processEditJob(createJob(validPayload), dependencies)).rejects.toThrow();

    expect(renderer.render).not.toHaveBeenCalled();
    expect(dependencies.renderedOutputStorage.uploadRenderedOutput).not.toHaveBeenCalled();
    expect(dependencies.prisma.editJob.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: validPayload.editJobId,
        },
        data: expect.objectContaining({
          status: EditJobStatus.FAILED,
        }),
      }),
    );
  });
});
