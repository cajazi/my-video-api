import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRenderOutputStorageKey } from "../storage/media-storage.paths";
import { FFmpegRenderer } from "./ffmpeg.renderer";

const editJobId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";
const userId = "c6218031-5061-4f49-a9fc-14f7f06798d0";
const videoId = "b5ff818d-5a1c-4bc0-9288-2a05377a8e58";
const localTestVideoPath = "C:\\tmp\\sample.mp4";

function createInput(overrides: { start?: number; end?: number } = {}) {
  return {
    editJobId,
    userId,
    videoId,
    sourceStorageKey: "uploads/source.mp4",
    inputConfig: {
      trim: {
        start: overrides.start ?? 1,
        end: overrides.end ?? 3,
      },
    },
  };
}

describe("FFmpegRenderer", () => {
  it("fails for invalid trim ranges", async () => {
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg: vi.fn(),
      createWorkspace: vi.fn(),
    });

    await expect(renderer.render(createInput({ start: 5, end: 5 }))).rejects.toThrow(
      "Invalid trim range: trim.start must be less than trim.end",
    );
  });

  it("creates the workspace and generates the expected ffmpeg command", async () => {
    const createWorkspace = vi.fn().mockResolvedValue(undefined);
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1750),
    });

    const result = await renderer.render(createInput());
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const localOutputPath = path.join(workspacePath, "output.mp4");

    expect(createWorkspace).toHaveBeenCalledWith(workspacePath);
    expect(executeFfmpeg).toHaveBeenCalledWith([
      "-y",
      "-i",
      localTestVideoPath,
      "-ss",
      "1",
      "-to",
      "3",
      "-c",
      "copy",
      localOutputPath,
    ]);
    expect(result).toEqual({
      outputStorageKey: createRenderOutputStorageKey({ userId, editJobId }),
      localOutputPath,
      durationMs: 750,
      metadata: {
        renderer: "ffmpeg",
        localOutputPath,
      },
    });
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
