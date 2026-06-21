import { describe, expect, it } from "vitest";
import { editSpecV1Schema } from "../edit-specs/edit-spec-v1.schema";
import { createTimelineRenderPlan } from "./timeline-render-plan";

const videoId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";

describe("createTimelineRenderPlan", () => {
  it("translates timeline clips to render segments without mixing timeline position and source trim", () => {
    const editSpec = editSpecV1Schema.parse({
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
                trimEndMs: 5000,
                durationMs: 3000,
              },
              {
                id: "clip-2",
                assetId: "asset-2",
                videoId,
                positionMs: 3000,
                trimStartMs: 12000,
                trimEndMs: 14000,
                durationMs: 2000,
              },
            ],
          },
        ],
      },
    });

    expect(createTimelineRenderPlan(editSpec)).toEqual({
      type: "timeline-render-plan-v1",
      segments: [
        {
          clipId: "clip-1",
          sourceVideoId: videoId,
          timelineStartMs: 0,
          timelineEndMs: 3000,
          trimStartMs: 2000,
          trimEndMs: 5000,
          durationMs: 3000,
        },
        {
          clipId: "clip-2",
          sourceVideoId: videoId,
          timelineStartMs: 3000,
          timelineEndMs: 5000,
          trimStartMs: 12000,
          trimEndMs: 14000,
          durationMs: 2000,
        },
      ],
    });
  });
});
