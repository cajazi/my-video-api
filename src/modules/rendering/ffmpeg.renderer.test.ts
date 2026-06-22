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

  it("renders dissolve transition operations with xfade and concatenates the dissolve output", async () => {
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
            timelineEndMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
            durationMs: 2000,
          },
          {
            type: "transition",
            exportSettings,
            transitionId: "transition-1",
            transitionType: "dissolve",
            fromClipId: "clip-1",
            toClipId: "clip-2",
            timelineStartMs: 2000,
            durationMs: 500,
            outputTimelineDurationMs: 500,
          },
          {
            type: "clip",
            exportSettings,
            clipId: "clip-2",
            sourceVideoId: videoId,
            timelineStartMs: 2000,
            timelineEndMs: 4000,
            trimStartMs: 5000,
            trimEndMs: 7000,
            durationMs: 2000,
          },
        ],
      }),
    );

    const dissolvePath = path.join(workspacePath, "dissolve-000.mp4");
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining(["-ss", "0", "-to", "2", segment0Path]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["-ss", "5", "-to", "7", segment1Path]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-filter_complex",
        "[0:v]scale=1080:1920,fps=60,format=yuv420p[v0];[1:v]scale=1080:1920,fps=60,format=yuv420p[v1];[v0][v1]xfade=transition=fade:duration=0.5:offset=1.5[v]",
        dissolvePath,
      ]),
    );
    expect(writeConcatList).toHaveBeenCalledWith(concatListPath, `file '${dissolvePath}'`);
    expect(executeFfmpeg).toHaveBeenCalledTimes(4);
  });

  it("renders chained dissolve transitions without duplicating the middle clip", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const writeConcatList = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList,
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1750),
    });
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const segment0Path = path.join(workspacePath, "segment-000.mp4");
    const segment1Path = path.join(workspacePath, "segment-001.mp4");
    const segment2Path = path.join(workspacePath, "segment-002.mp4");
    const dissolvePath = path.join(workspacePath, "dissolve-000.mp4");
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
            timelineEndMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
            durationMs: 3000,
          },
          {
            type: "transition",
            exportSettings,
            transitionId: "transition-1",
            transitionType: "dissolve",
            fromClipId: "clip-1",
            toClipId: "clip-2",
            timelineStartMs: 3000,
            durationMs: 1000,
            outputTimelineDurationMs: 1000,
          },
          {
            type: "clip",
            exportSettings,
            clipId: "clip-2",
            sourceVideoId: videoId,
            timelineStartMs: 3000,
            timelineEndMs: 7000,
            trimStartMs: 5000,
            trimEndMs: 9000,
            durationMs: 4000,
          },
          {
            type: "transition",
            exportSettings,
            transitionId: "transition-2",
            transitionType: "dissolve",
            fromClipId: "clip-2",
            toClipId: "clip-3",
            timelineStartMs: 7000,
            durationMs: 500,
            outputTimelineDurationMs: 500,
          },
          {
            type: "clip",
            exportSettings,
            clipId: "clip-3",
            sourceVideoId: videoId,
            timelineStartMs: 7000,
            timelineEndMs: 9000,
            trimStartMs: 12000,
            trimEndMs: 14000,
            durationMs: 2000,
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining(["-ss", "0", "-to", "3", segment0Path]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["-ss", "5", "-to", "9", segment1Path]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining(["-ss", "12", "-to", "14", segment2Path]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      4,
      expect.arrayContaining([
        "-filter_complex",
        "[0:v]scale=1080:1920,fps=60,format=yuv420p[v0];[1:v]scale=1080:1920,fps=60,format=yuv420p[v1];[2:v]scale=1080:1920,fps=60,format=yuv420p[v2];[v0][v1]xfade=transition=fade:duration=1:offset=2[x1];[x1][v2]xfade=transition=fade:duration=0.5:offset=5.5[v]",
        dissolvePath,
      ]),
    );
    expect(writeConcatList).toHaveBeenCalledWith(concatListPath, `file '${dissolvePath}'`);
    expect(writeConcatList).not.toHaveBeenCalledWith(
      concatListPath,
      expect.stringContaining(`file '${segment1Path}'\nfile '${segment1Path}'`),
    );
    expect(executeFfmpeg).toHaveBeenCalledTimes(5);
  });

  it("renders dip_to_black transition operations with a black color phase", async () => {
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
    const segment0Path = path.join(workspacePath, "segment-000.mp4");
    const segment1Path = path.join(workspacePath, "segment-001.mp4");
    const dipPath = path.join(workspacePath, "dip-000.mp4");
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
            timelineEndMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
            durationMs: 2000,
          },
          {
            type: "transition",
            exportSettings,
            transitionId: "transition-1",
            transitionType: "dip_to_black",
            fromClipId: "clip-1",
            toClipId: "clip-2",
            timelineStartMs: 2000,
            durationMs: 500,
            outputTimelineDurationMs: 500,
          },
          {
            type: "clip",
            exportSettings,
            clipId: "clip-2",
            sourceVideoId: videoId,
            timelineStartMs: 2000,
            timelineEndMs: 4000,
            trimStartMs: 5000,
            trimEndMs: 7000,
            durationMs: 2000,
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-f",
        "lavfi",
        "-i",
        "color=c=0x000000:s=1080x1920:r=60:d=0.25",
        "-filter_complex",
        "[0:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v0];[1:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v1];[2:v]format=yuv420p,setpts=PTS-STARTPTS,split=2[colorout][colorin];[v0]trim=start=0:end=1.75,setpts=PTS-STARTPTS[outbody];[v0]trim=start=1.75:end=2,setpts=PTS-STARTPTS[outtail];[outtail][colorout]xfade=transition=fade:duration=0.25:offset=0[outfade];[v1]trim=start=0:end=0.25,setpts=PTS-STARTPTS[intail];[colorin][intail]xfade=transition=fade:duration=0.25:offset=0[infade];[v1]trim=start=0.25:end=2,setpts=PTS-STARTPTS[inbody];[outbody][outfade][infade][inbody]concat=n=4:v=1:a=0[v]",
        dipPath,
      ]),
    );
    expect(writeConcatList).toHaveBeenCalledWith(concatListPath, `file '${dipPath}'`);
    expect(writeConcatList).not.toHaveBeenCalledWith(
      concatListPath,
      expect.stringContaining(`file '${segment0Path}'\nfile '${segment1Path}'`),
    );
    expect(executeFfmpeg).toHaveBeenCalledTimes(4);
  });

  it("renders dip_to_white transition operations with a white color phase", async () => {
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
    const dipPath = path.join(workspacePath, "dip-000.mp4");

    await renderer.render(
      createInput({
        segments: [
          {
            type: "clip",
            exportSettings,
            clipId: "clip-1",
            sourceVideoId: videoId,
            timelineStartMs: 0,
            timelineEndMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
            durationMs: 3000,
          },
          {
            type: "transition",
            exportSettings,
            transitionId: "transition-1",
            transitionType: "dip_to_white",
            fromClipId: "clip-1",
            toClipId: "clip-2",
            timelineStartMs: 3000,
            durationMs: 1000,
            outputTimelineDurationMs: 1000,
          },
          {
            type: "clip",
            exportSettings,
            clipId: "clip-2",
            sourceVideoId: videoId,
            timelineStartMs: 3000,
            timelineEndMs: 6000,
            trimStartMs: 5000,
            trimEndMs: 8000,
            durationMs: 3000,
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "color=c=0xFFFFFF:s=1080x1920:r=60:d=0.5",
        "-filter_complex",
        expect.stringContaining("[outtail][colorout]xfade=transition=fade:duration=0.5:offset=0[outfade]"),
        dipPath,
      ]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.stringContaining("[colorin][intail]xfade=transition=fade:duration=0.5:offset=0[infade]"),
      ]),
    );
  });

  it("fails explicitly for unsupported slide and zoom transition operations", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      renderer.render(
        createInput({
          segments: [
            {
              type: "clip",
              exportSettings,
              clipId: "clip-1",
              sourceVideoId: videoId,
              timelineStartMs: 0,
              timelineEndMs: 2000,
              trimStartMs: 0,
              trimEndMs: 2000,
              durationMs: 2000,
            },
            {
              type: "transition",
              exportSettings,
              transitionId: "transition-1",
              transitionType: "slide_left",
              fromClipId: "clip-1",
              toClipId: "clip-2",
              timelineStartMs: 2000,
              durationMs: 500,
              outputTimelineDurationMs: 500,
            },
            {
              type: "clip",
              exportSettings,
              clipId: "clip-2",
              sourceVideoId: videoId,
              timelineStartMs: 2000,
              timelineEndMs: 4000,
              trimStartMs: 5000,
              trimEndMs: 7000,
              durationMs: 2000,
            },
          ],
        }),
      ),
    ).rejects.toThrow("Unsupported transition renderer: slide_left");

    await expect(
      renderer.render(
        createInput({
          segments: [
            {
              type: "clip",
              exportSettings,
              clipId: "clip-1",
              sourceVideoId: videoId,
              timelineStartMs: 0,
              timelineEndMs: 2000,
              trimStartMs: 0,
              trimEndMs: 2000,
              durationMs: 2000,
            },
            {
              type: "transition",
              exportSettings,
              transitionId: "transition-1",
              transitionType: "zoom_out",
              fromClipId: "clip-1",
              toClipId: "clip-2",
              timelineStartMs: 2000,
              durationMs: 500,
              outputTimelineDurationMs: 500,
            },
            {
              type: "clip",
              exportSettings,
              clipId: "clip-2",
              sourceVideoId: videoId,
              timelineStartMs: 2000,
              timelineEndMs: 4000,
              trimStartMs: 5000,
              trimEndMs: 7000,
              durationMs: 2000,
            },
          ],
        }),
      ),
    ).rejects.toThrow("Unsupported transition renderer: zoom_out");
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
