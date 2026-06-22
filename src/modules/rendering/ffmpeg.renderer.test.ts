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

function createInput(overrides: { startMs?: number; endMs?: number; segments?: unknown[]; audioTracks?: unknown[] } = {}) {
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
      ...(overrides.audioTracks ? { audioTracks: overrides.audioTracks } : {}),
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

  it("mixes a single audio clip into the rendered output", async () => {
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
    const videoOutputPath = path.join(workspacePath, "video-output.mp4");
    const mixedAudioPath = path.join(workspacePath, "mixed-audio.m4a");
    const localOutputPath = path.join(workspacePath, "output.mp4");

    await renderer.render(
      createInput({
        startMs: 0,
        endMs: 3000,
        audioTracks: [
          {
            id: "audio-track-1",
            type: "audio",
            clips: [
              {
                id: "audio-clip-1",
                assetId: "audio-asset-1",
                positionMs: 0,
                trimStartMs: 1000,
                trimEndMs: 3000,
                durationMs: 2000,
                volume: 0.8,
              },
            ],
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(2, expect.arrayContaining(["-f", "concat", videoOutputPath]));
    expect(executeFfmpeg).toHaveBeenNthCalledWith(3, [
      "-y",
      "-i",
      localTestVideoPath,
      "-filter_complex",
      "[0:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,volume=0.8,adelay=0|0[a0];[a0]apad,atrim=0:3,asetpts=PTS-STARTPTS[a]",
      "-map",
      "[a]",
      "-vn",
      "-c:a",
      "aac",
      mixedAudioPath,
    ]);
    expect(executeFfmpeg).toHaveBeenNthCalledWith(4, [
      "-y",
      "-i",
      videoOutputPath,
      "-i",
      mixedAudioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      localOutputPath,
    ]);
  });

  it("delays audio clips placed after timeline start", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });

    await renderer.render(
      createInput({
        startMs: 0,
        endMs: 3000,
        audioTracks: [
          {
            id: "audio-track-1",
            type: "audio",
            clips: [
              {
                id: "audio-clip-1",
                assetId: "audio-asset-1",
                positionMs: 750,
                trimStartMs: 0,
                trimEndMs: 1000,
                durationMs: 1000,
                volume: 1,
              },
            ],
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-filter_complex",
        "[0:a]atrim=start=0:end=1,asetpts=PTS-STARTPTS,volume=1,adelay=750|750[a0];[a0]apad,atrim=0:3,asetpts=PTS-STARTPTS[a]",
      ]),
    );
  });

  it("applies audio fade in and fade out filters", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });

    await renderer.render(
      createInput({
        startMs: 0,
        endMs: 4000,
        audioTracks: [
          {
            id: "audio-track-1",
            type: "audio",
            clips: [
              {
                id: "audio-clip-1",
                assetId: "audio-asset-1",
                positionMs: 0,
                trimStartMs: 0,
                trimEndMs: 3000,
                durationMs: 3000,
                volume: 0.5,
                fadeInMs: 500,
                fadeOutMs: 1000,
              },
            ],
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-filter_complex",
        expect.stringContaining("volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st=2:d=1,adelay=0|0[a0]"),
      ]),
    );
  });

  it("mixes overlapping audio clips across audio tracks", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });

    await renderer.render(
      createInput({
        startMs: 0,
        endMs: 3000,
        audioTracks: [
          {
            id: "audio-track-1",
            type: "audio",
            clips: [
              {
                id: "audio-clip-1",
                assetId: "audio-asset-1",
                positionMs: 0,
                trimStartMs: 0,
                trimEndMs: 2000,
                durationMs: 2000,
                volume: 0.7,
              },
            ],
          },
          {
            id: "audio-track-2",
            type: "audio",
            clips: [
              {
                id: "audio-clip-2",
                assetId: "audio-asset-2",
                positionMs: 500,
                trimStartMs: 3000,
                trimEndMs: 5000,
                durationMs: 2000,
                volume: 0.6,
              },
            ],
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-i",
        localTestVideoPath,
        "-i",
        localTestVideoPath,
        "-filter_complex",
        expect.stringContaining("[a0][a1]amix=inputs=2:duration=longest:normalize=0,apad,atrim=0:3"),
      ]),
    );
  });

  it("trims mixed audio to video-driven output duration", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });

    await renderer.render(
      createInput({
        startMs: 0,
        endMs: 2000,
        audioTracks: [
          {
            id: "audio-track-1",
            type: "audio",
            clips: [
              {
                id: "audio-clip-1",
                assetId: "audio-asset-1",
                positionMs: 0,
                trimStartMs: 0,
                trimEndMs: 5000,
                durationMs: 5000,
                volume: 1,
              },
            ],
          },
        ],
      }),
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-filter_complex",
        expect.stringContaining("[a0]apad,atrim=0:2,asetpts=PTS-STARTPTS[a]"),
      ]),
    );
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
        "[0:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v0];[1:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v1];[v0]trim=start=0:end=1.5,setpts=PTS-STARTPTS[body0];[2:v]format=yuv420p,setpts=PTS-STARTPTS,split=2[colorout0][colorin0];[v0]trim=start=1.5:end=1.75,setpts=PTS-STARTPTS[out0];[out0][colorout0]xfade=transition=fade:duration=0.25:offset=0[outfade0];[v1]trim=start=0:end=0.25,setpts=PTS-STARTPTS[in0];[colorin0][in0]xfade=transition=fade:duration=0.25:offset=0[infade0];[outfade0][infade0]concat=n=2:v=1:a=0[transition0];[v1]trim=start=0.5:end=2,setpts=PTS-STARTPTS[body2];[body0][transition0][body2]concat=n=3:v=1:a=0[v]",
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
        expect.stringContaining("[out0][colorout0]xfade=transition=fade:duration=0.5:offset=0[outfade0]"),
        dipPath,
      ]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.stringContaining("[colorin0][in0]xfade=transition=fade:duration=0.5:offset=0[infade0]"),
      ]),
    );
  });

  it("renders slide_left transition operations with incoming motion from right to left", async () => {
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
    const chainPath = path.join(workspacePath, "transition-chain-000.mp4");
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
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-filter_complex",
        "[0:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v0];[1:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v1];[v0]trim=start=0:end=1.5,setpts=PTS-STARTPTS[body0];[v0]trim=start=1.5:end=2,setpts=PTS-STARTPTS[out0];[v1]trim=start=0:end=0.5,setpts=PTS-STARTPTS[in0];[out0][in0]overlay=x='W-W*t/0.5':y=0:shortest=1[transition0];[v1]trim=start=0.5:end=2,setpts=PTS-STARTPTS[body2];[body0][transition0][body2]concat=n=3:v=1:a=0[v]",
        chainPath,
      ]),
    );
    expect(writeConcatList).toHaveBeenCalledWith(concatListPath, `file '${chainPath}'`);
    expect(executeFfmpeg).toHaveBeenCalledTimes(4);
  });

  it("renders slide_right transition operations with incoming motion from left to right", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const chainPath = path.join(workspacePath, "transition-chain-000.mp4");

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
            transitionType: "slide_right",
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
        "-filter_complex",
        expect.stringContaining("[0:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v0]"),
        expect.stringContaining("[out0][in0]overlay=x='-W+W*t/1':y=0:shortest=1[transition0]"),
        chainPath,
      ]),
    );
  });

  it("renders zoom_in transition operations on the export canvas", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const chainPath = path.join(workspacePath, "transition-chain-000.mp4");

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
            transitionType: "zoom_in",
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
        "-filter_complex",
        expect.stringContaining("[0:v]scale=1080:1920,fps=60,format=yuv420p,setpts=PTS-STARTPTS[v0]"),
        expect.stringContaining("[out0]scale=w='trunc(iw*(1-0.2*t/1)/2)*2':h='trunc(ih*(1-0.2*t/1)/2)*2':eval=frame,setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,crop=1080:1920[outzoom0]"),
        expect.stringContaining("[in0]scale=w='trunc(iw*(1.2-0.2*t/1)/2)*2':h='trunc(ih*(1.2-0.2*t/1)/2)*2':eval=frame,setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,crop=1080:1920[inzoom0]"),
        expect.stringContaining("[outzoom0][inzoom0]blend=all_expr='A*(1-T/1)+B*(T/1)'[transition0]"),
        chainPath,
      ]),
    );
  });

  it("renders zoom_out transition operations on the export canvas", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });
    const workspacePath = path.resolve(process.cwd(), "tmp", "jobs", editJobId);
    const chainPath = path.join(workspacePath, "transition-chain-000.mp4");

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
    );

    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "-filter_complex",
        expect.stringContaining("[out0]scale=w='trunc(iw*(1+0.2*t/0.5)/2)*2':h='trunc(ih*(1+0.2*t/0.5)/2)*2':eval=frame,setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,crop=1080:1920[outzoom0]"),
        expect.stringContaining("[in0]scale=w='trunc(iw*(0.8+0.2*t/0.5)/2)*2':h='trunc(ih*(0.8+0.2*t/0.5)/2)*2':eval=frame,setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,crop=1080:1920[inzoom0]"),
        expect.stringContaining("[outzoom0][inzoom0]blend=all_expr='A*(1-T/0.5)+B*(T/0.5)'[transition0]"),
        chainPath,
      ]),
    );
  });

  it("renders chained dip_to_black followed by dip_to_white without duplicating the middle clip", async () => {
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
    const chainPath = path.join(workspacePath, "transition-chain-000.mp4");
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
            transitionType: "dip_to_black",
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
            transitionType: "dip_to_white",
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
      4,
      expect.arrayContaining([
        "color=c=0x000000:s=1080x1920:r=60:d=0.5",
        "color=c=0xFFFFFF:s=1080x1920:r=60:d=0.25",
        "-filter_complex",
        expect.stringContaining("[body0][transition0][body2][transition1][body4]concat=n=5:v=1:a=0[v]"),
        chainPath,
      ]),
    );
    expect(executeFfmpeg).toHaveBeenNthCalledWith(
      4,
      expect.arrayContaining([
        expect.stringMatching(/\[v1\]trim=start=1:end=3\.5,setpts=PTS-STARTPTS\[body2\]/),
      ]),
    );
    expect(writeConcatList).toHaveBeenCalledWith(concatListPath, `file '${chainPath}'`);
    expect(executeFfmpeg).toHaveBeenCalledTimes(5);
  });

  it("renders dissolve followed by dip_to_black in timeline order", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });

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
            transitionType: "dip_to_black",
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
      4,
      expect.arrayContaining([
        "-filter_complex",
        expect.stringMatching(/\[out0\]\[in0\]xfade=transition=fade:duration=1:offset=0\[transition0\].*\[out1\]\[colorout0\]xfade=transition=fade:duration=0\.25:offset=0\[outfade1\]/),
      ]),
    );
  });

  it("renders dip_to_white followed by dissolve in timeline order", async () => {
    const executeFfmpeg = vi.fn().mockResolvedValue(undefined);
    const renderer = new FFmpegRenderer({
      localTestVideoPath,
      checkAvailability: vi.fn().mockResolvedValue(true),
      executeFfmpeg,
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      writeConcatList: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500),
    });

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
      4,
      expect.arrayContaining([
        "-filter_complex",
        expect.stringMatching(/\[out0\]\[colorout0\]xfade=transition=fade:duration=0\.5:offset=0\[outfade0\].*\[out1\]\[in1\]xfade=transition=fade:duration=0\.5:offset=0\[transition1\]/),
      ]),
    );
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
