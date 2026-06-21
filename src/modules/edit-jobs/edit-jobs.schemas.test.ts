import { describe, expect, it } from "vitest";
import { createEditJobSchema } from "./edit-jobs.schemas";

const videoId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";
const exportSettings = {
  resolutionPreset: "1080p",
  width: 1920,
  height: 1080,
  aspectRatio: "16:9",
  fps: 30,
  backgroundFillColor: "#101820",
};

function createClip(overrides: Record<string, unknown> = {}) {
  return {
    id: "clip-1",
    assetId: "asset-1",
    videoId,
    positionMs: 0,
    trimStartMs: 5000,
    trimEndMs: 60000,
    durationMs: 55000,
    ...overrides,
  };
}

function createValidEditSpec(
  clips: Record<string, unknown>[] = [createClip()],
  settings: Record<string, unknown> = exportSettings,
) {
  return {
    version: "1",
    timeline: {
      exportSettings: settings,
      tracks: [
        {
          id: "track-1",
          type: "video",
          clips,
        },
      ],
    },
  };
}

describe("createEditJobSchema", () => {
  it("accepts a valid single-clip timeline edit spec", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(),
    });

    expect(result.success).toBe(true);
  });

  it("accepts valid export settings", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.editSpec.timeline.exportSettings).toEqual(exportSettings);
    }
  });

  it.each([
    ["720p 16:9", { resolutionPreset: "720p", width: 1280, height: 720, aspectRatio: "16:9" }],
    ["720p 9:16", { resolutionPreset: "720p", width: 720, height: 1280, aspectRatio: "9:16" }],
    ["1080p 1:1", { resolutionPreset: "1080p", width: 1920, height: 1920, aspectRatio: "1:1" }],
    ["1080p 4:5", { resolutionPreset: "1080p", width: 1536, height: 1920, aspectRatio: "4:5" }],
    ["4K 16:9", { resolutionPreset: "4K", width: 3840, height: 2160, aspectRatio: "16:9" }],
  ])("accepts valid export combination %s", (_name, settings) => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(undefined, {
        ...exportSettings,
        ...settings,
      }),
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid fps values", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: {
        ...createValidEditSpec(),
        timeline: {
          ...createValidEditSpec().timeline,
          exportSettings: {
            ...exportSettings,
            fps: 25,
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid aspect ratios", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: {
        ...createValidEditSpec(),
        timeline: {
          ...createValidEditSpec().timeline,
          exportSettings: {
            ...exportSettings,
            aspectRatio: "3:2",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects dimensions that do not match the selected aspect ratio", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(undefined, {
        ...exportSettings,
        width: 1080,
        height: 1920,
        aspectRatio: "16:9",
      }),
    });

    expect(result.success).toBe(false);
  });

  it("rejects dimensions that do not match the resolution preset", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(undefined, {
        ...exportSettings,
        resolutionPreset: "720p",
        width: 1920,
        height: 1080,
      }),
    });

    expect(result.success).toBe(false);
  });

  it("rejects odd export widths", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(undefined, {
        ...exportSettings,
        width: 1919,
      }),
    });

    expect(result.success).toBe(false);
  });

  it("rejects odd export heights", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(undefined, {
        ...exportSettings,
        height: 1079,
      }),
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid background fill colors", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec(undefined, {
        ...exportSettings,
        backgroundFillColor: "101820",
      }),
    });

    expect(result.success).toBe(false);
  });

  it("accepts multiple sequential clips on a single video track", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          id: "clip-1",
          positionMs: 0,
          trimStartMs: 0,
          trimEndMs: 1000,
          durationMs: 1000,
        }),
        createClip({
          id: "clip-2",
          positionMs: 1000,
          trimStartMs: 5000,
          trimEndMs: 8000,
          durationMs: 3000,
        }),
      ]),
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid video ids", () => {
    const result = createEditJobSchema.safeParse({
      videoId: "not-a-uuid",
      editSpec: createValidEditSpec(),
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid negative source trim times", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          trimStartMs: -1,
        }),
      ]),
    });

    expect(result.success).toBe(false);
  });

  it("rejects trimEndMs values that are not greater than trimStartMs", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          trimStartMs: 5000,
          trimEndMs: 5000,
          durationMs: 0,
        }),
      ]),
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative timeline positions", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          positionMs: -1,
        }),
      ]),
    });

    expect(result.success).toBe(false);
  });

  it("accepts positive timeline gaps between clips", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          id: "clip-1",
          positionMs: 0,
          trimStartMs: 0,
          trimEndMs: 1000,
          durationMs: 1000,
        }),
        createClip({
          id: "clip-2",
          positionMs: 1500,
          trimStartMs: 2000,
          trimEndMs: 3000,
          durationMs: 1000,
        }),
      ]),
    });

    expect(result.success).toBe(true);
  });

  it("rejects overlapping clips", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          id: "clip-1",
          positionMs: 0,
          trimStartMs: 0,
          trimEndMs: 1000,
          durationMs: 1000,
        }),
        createClip({
          id: "clip-2",
          positionMs: 500,
          trimStartMs: 2000,
          trimEndMs: 3000,
          durationMs: 1000,
        }),
      ]),
    });

    expect(result.success).toBe(false);
  });

  it("rejects clips that are not sorted by positionMs", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          id: "clip-1",
          positionMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
          durationMs: 1000,
        }),
        createClip({
          id: "clip-2",
          positionMs: 0,
          trimStartMs: 2000,
          trimEndMs: 3000,
          durationMs: 1000,
        }),
      ]),
    });

    expect(result.success).toBe(false);
  });

  it("rejects timelines where the first clip does not start at positionMs 0", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec([
        createClip({
          positionMs: 500,
          trimStartMs: 0,
          trimEndMs: 1000,
          durationMs: 1000,
        }),
      ]),
    });

    expect(result.success).toBe(false);
  });
});
