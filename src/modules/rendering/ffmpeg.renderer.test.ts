import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRenderOutputStorageKey } from "../storage/media-storage.paths";
import { FFmpegRenderer } from "./ffmpeg.renderer";

const editJobId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";
const userId = "c6218031-5061-4f49-a9fc-14f7f06798d0";
const videoId = "b5ff818d-5a1c-4bc0-9288-2a05377a8e58";
const localTestVideoPath = "C:\\tmp\\sample.mp4";
const exportSettings = {
  resolutionPreset: "1080p",
  width: 1080,
  height: 1920,
  aspectRatio: "9:16",
  fps: 60,
  backgroundFillColor: "#123abc",
} as const;

function createInput(overrides: { startMs?: number; endMs?: number; segments?: unknown[] } = {}) {
  return {
    editJobId,
    userId,
    videoId,
    sourceStorageKey: "uploads/source.mp4",
    inputConfig: {
      type: "timeline-render-plan-v1",
      exportSettings,
      segments:
        overrides.segments ??
        [
          {
            type: "clip",
            exportSettings,
            clipId: "clip-1",
            sourceVideoId: videoId,
            timelineStartMs: 0,
            timelineEndMs: (overrides.endMs ?? 3000) - (overrides.startMs ?? 1000),
            trimStartMs: overrides.startMs ?? 1000,
            trimEndMs: overrides.endMs ?? 3000,
            durationMs: (overrides.endMs ?? 3000) - (overrides.startMs ?? 1000),
          },
        ],
    },
  };
}

describe("FFmpegRenderer", () => {
  it("fails for invalid render plans", async () => {
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg: vi.fn(),
      createWorkspace: vi.fn(),
    });

    await expect(
      renderer.render({
        ...createInput(),
        inputConfig: {
          type: "timeline-render-plan-v1",
          segments: [],
        },
      }),
    ).rejects.toThrow();
  });

  it("creates the workspace, trims one segment, and concatenates the final output", async () => {
    const createWorkspace = vi.fn().mockResolvedValue(undefined);
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const writeConcatList = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace,
      writeConcatList,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1750),
    });

    const result = await renderer.render(createInput());
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const localOutputPath = path.join(workspacePath, "output.mp4");
    const segmentOutputPath = path.join(workspacePath, "segment-000.mp4");
    const concatListPath = path.join(workspacePath, "concat-list.txt");

    expect(createWorkspace).toHaveBeenCalledWith(workspacePath);
    expect(executeFfmpeg).toHaveBeenNthCalledWith(1, [
      "-y",
      "-i",
      localTestVideoPath,
      "-ss",
      "1",
      "-to",
      "3",
      "-c",
      "copy",
      segmentOutputPath,
    ]);
    expect(writeConcatList).toHaveBeenCalledWith(concatListPath, `file '${segmentOutputPath}'`);
    expect(executeFfmpeg).toHaveBeenNthCalledWith(2, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-vf",
      "scale=1080:1920,fps=60",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      localOutputPath,
    ]);
    expect(result).toEqual({
      outputStorageKey: createRenderOutputStorageKey({ userId, editJobId }),
      localOutputPath,
      durationMs: 750,
      metadata: {
        renderer: "ffmpeg",
        segmentCount: 1,
        localOutputPath,
      },
    });
  });

  it("trims multiple clips in timeline order before concat", async () => {
    const createWorkspace = vi.fn().mockResolvedValue(undefined);
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const writeConcatList = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace,
      writeConcatList,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const segment0Path = path.join(workspacePath, "segment-000.mp4");
    const segment1Path = path.join(workspacePath, "segment-001.mp4");
    const concatListPath = path.join(workspacePath, "concat-list.txt");

    await renderer.render(
      createInput({
        segments: [
          {
            type: "clip",
            exportSettings,
            clipId: "clip-1",
            sourceVideoId: videoId,
            timelineStartMs: 0,
            timelineEndMs: 1500,
            trimStartMs: 1000,
            trimEndMs: 2500,
            durationMs: 1500,
          },
          {
            type: "clip",
            exportSettings,
            clipId: "clip-2",
            sourceVideoId: videoId,
            timelineStartMs: 1500,
            timelineEndMs: 4000,
            trimStartMs: 5000,
            trimEndMs: 7500,
            durationMs: 2500,
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining(["-ss", "1", "-to", "2.5", segment0Path]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["-ss", "5", "-to", "7.5", segment1Path]),
    );
    expect(writeConcatList).toHaveBeenCalledWith(concatListPath, `file '${segment0Path}'\nfile '${segment1Path}'`);
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-f",
        "concat",
        "-i",
        concatListPath,
        "-vf",
        "scale=1080:1920,fps=60",
        path.join(workspacePath, "output.mp4"),
      ]),
    );
  });

  it("creates black filler segments for timeline gaps", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const writeConcatList = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const fillerPath = path.join(workspacePath, "segment-001.mp4");

    await renderer.render(
      createInput({
        segments: [
          {
            type: "clip",
            exportSettings,
            clipId: "clip-1",
            sourceVideoId: videoId,
            timelineStartMs: 0,
            timelineEndMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
            durationMs: 1000,
          },
          {
            type: "filler",
            exportSettings,
            fillerId: "gap-1",
            timelineStartMs: 1000,
            timelineEndMs: 2500,
            durationMs: 1500,
            fill: {
              kind: "black",
              color: "#123abc",
            },
          },
          {
            type: "clip",
            exportSettings,
            clipId: "clip-2",
            sourceVideoId: videoId,
            timelineStartMs: 2500,
            timelineEndMs: 3500,
            trimStartMs: 5000,
            trimEndMs: 6000,
            durationMs: 1000,
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(2, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x123abc:s=1080x1920:r=60:d=1.5",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      fillerPath,
    ]);
  });

  it("fails when ffmpeg is missing", async () => {
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(false),
      executeFfmpeg: vi.fn(),
      createWorkspace: vi.fn(),
    });

    await expect(renderer.render(createInput())).rejects.toThrow("FFmpeg is not available");
  });

  it("fails when LOCAL_TEST_VIDEO_PATH is missing", async () => {
    const renderer = new FFmpegRenderer({
      localTestVideoPath: "",
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg: vi.fn(),
      createWorkspace: vi.fn(),
    });

    await expect(renderer.render(createInput())).rejects.toThrow(
      "LOCAL_TEST_VIDEO_PATH is required for FFmpeg rendering",
    );
  });
});
