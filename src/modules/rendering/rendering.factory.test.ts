import { describe, expect, it, vi } from "vitest";

vi.mock("./ffmpeg.utils", () => ({
  checkFfmpegAvailability: vi.fn(),
}));

import { FFmpegRenderer } from "./ffmpeg.renderer";
import { checkFfmpegAvailability } from "./ffmpeg.utils";
import { MockRenderer } from "./mock.renderer";
import { RenderingFactory } from "./rendering.factory";
import { getEditJobWorkspacePath } from "./workspace.util";

const prisma = {
  editJob: {},
  video: {},
};

describe("RenderingFactory", () => {
  it("creates a mock renderer for the mock provider", async () => {
    const factory = new RenderingFactory(prisma, "mock");

    await expect(factory.createRenderer()).resolves.toBeInstanceOf(MockRenderer);
    expect(checkFfmpegAvailability).not.toHaveBeenCalled();
  });

  it("creates an ffmpeg renderer when ffmpeg is available", async () => {
    vi.mocked(checkFfmpegAvailability).mockResolvedValueOnce(true);
    const factory = new RenderingFactory(prisma, "ffmpeg");

    await expect(factory.createRenderer()).resolves.toBeInstanceOf(FFmpegRenderer);
  });

  it("fails fast for ffmpeg provider when ffmpeg is unavailable", async () => {
    vi.mocked(checkFfmpegAvailability).mockResolvedValueOnce(false);
    const factory = new RenderingFactory(prisma, "ffmpeg");

    await expect(factory.createRenderer()).rejects.toThrow("FFmpeg renderer selected but ffmpeg is not available");
  });
});

describe("getEditJobWorkspacePath", () => {
  it("returns a workspace path under tmp/jobs", () => {
    expect(getEditJobWorkspacePath("edit-job-id")).toMatch(/tmp[\\/]jobs[\\/]edit-job-id$/);
  });
});
