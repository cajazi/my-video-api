import { describe, expect, it } from "vitest";
import { createEditJobSchema } from "./edit-jobs.schemas";

const videoId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";

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

function createValidEditSpec(clips: Record<string, unknown>[] = [createClip()]) {
  return {
    version: "1",
    timeline: {
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
