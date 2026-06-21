import { describe, expect, it } from "vitest";
import { createEditJobSchema } from "./edit-jobs.schemas";

const videoId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";

function createValidEditSpec(overrides: Record<string, unknown> = {}) {
  return {
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
              trimStartMs: 5000,
              trimEndMs: 60000,
              durationMs: 55000,
              ...overrides,
            },
          ],
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
      editSpec: createValidEditSpec({
        trimStartMs: -1,
      }),
    });

    expect(result.success).toBe(false);
  });

  it("rejects trimEndMs values that are not greater than trimStartMs", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec({
        trimStartMs: 5000,
        trimEndMs: 5000,
        durationMs: 0,
      }),
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative timeline positions", () => {
    const result = createEditJobSchema.safeParse({
      videoId,
      editSpec: createValidEditSpec({
        positionMs: -1,
      }),
    });

    expect(result.success).toBe(false);
  });
});
