import { describe, expect, it, vi } from "vitest";
import { createRenderOutputStorageKey } from "../storage/media-storage.paths";
import { MockRenderer } from "./mock.renderer";
import type { Renderer } from "./renderer.interface";
import { RenderingService } from "./rendering.service";

const editJobId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";
const userId = "c6218031-5061-4f49-a9fc-14f7f06798d0";
const videoId = "b5ff818d-5a1c-4bc0-9288-2a05377a8e58";
const sourceStorageKey = "uploads/source.mp4";
const outputStorageKey = createRenderOutputStorageKey({ userId, editJobId });
const editSpec = {
  version: "1",
  timeline: {
    tracks: [
      {
        id: "track-1",
        type: "video",
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            videoId,
            positionMs: 0,
            trimStartMs: 2000,
            trimEndMs: 6500,
            durationMs: 4500,
          },
          {
            id: "clip-2",
            assetId: "asset-2",
            videoId,
            positionMs: 4500,
            trimStartMs: 10000,
            trimEndMs: 13000,
            durationMs: 3000,
          },
        ],
      },
    ],
  },
};

function createPrismaMock(overrides: { videoOwnerId?: string } = {}) {
  return {
    editJob: {
      findUnique: vi.fn().mockResolvedValue({
        id: editJobId,
        userId,
        videoId,
        inputConfig: editSpec,
      }),
    },
    video: {
      findUnique: vi.fn().mockResolvedValue({
        id: videoId,
        ownerId: overrides.videoOwnerId ?? userId,
        storageKey: sourceStorageKey,
      }),
    },
  };
}

describe("MockRenderer", () => {
  it("returns a deterministic mock output storage key", async () => {
    const renderer = new MockRenderer(vi.fn().mockResolvedValue(undefined));

    const result = await renderer.render({
      editJobId,
      userId,
      videoId,
      inputConfig: {},
      sourceStorageKey,
    });

    expect(result.outputStorageKey).toBe(outputStorageKey);
    expect(result.localOutputPath).toMatch(/tmp[\\/]jobs[\\/]0f6979d0-4db1-49f7-b99f-6f5b6f706286[\\/]output.mp4$/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata).toMatchObject({
      renderer: "mock",
      sourceStorageKey,
    });
  });
});

describe("RenderingService", () => {
  it("loads edit spec and converts timeline clips to render segments", async () => {
    const prisma = createPrismaMock();
    const renderer: Renderer = {
      render: vi.fn().mockResolvedValue({
        outputStorageKey,
        localOutputPath: "C:\\tmp\\jobs\\output.mp4",
        durationMs: 1000,
      }),
    };
    const service = new RenderingService(prisma, renderer);

    const result = await service.renderEditJob(editJobId);

    expect(prisma.editJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: editJobId,
        },
      }),
    );
    expect(prisma.video.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: videoId,
        },
      }),
    );
    expect(renderer.render).toHaveBeenCalledWith({
      editJobId,
      userId,
      videoId,
      inputConfig: {
        type: "timeline-render-plan-v1",
        segments: [
          {
            clipId: "clip-1",
            sourceVideoId: videoId,
            timelineStartMs: 0,
            timelineEndMs: 4500,
            trimStartMs: 2000,
            trimEndMs: 6500,
            durationMs: 4500,
          },
          {
            clipId: "clip-2",
            sourceVideoId: videoId,
            timelineStartMs: 4500,
            timelineEndMs: 7500,
            trimStartMs: 10000,
            trimEndMs: 13000,
            durationMs: 3000,
          },
        ],
      },
      sourceStorageKey,
    });
    expect(result.outputStorageKey).toBe(outputStorageKey);
  });

  it("fails when edit job and video ownership do not match", async () => {
    const prisma = createPrismaMock({
      videoOwnerId: "2ed4a0ce-1e84-45d0-a451-68c98282e65f",
    });
    const renderer: Renderer = {
      render: vi.fn(),
    };
    const service = new RenderingService(prisma, renderer);

    await expect(service.renderEditJob(editJobId)).rejects.toThrow("Edit job and video ownership mismatch");
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
