import { describe, expect, it } from "vitest";
import { editSpecV1Schema } from "../edit-specs/edit-spec-v1.schema";
import { createTimelineRenderPlan } from "./timeline-render-plan";

const videoId = "0f6979d0-4db1-49f7-b99f-6f5b6f706286";
const exportSettings = {
  resolutionPreset: "1080p",
  width: 1920,
  height: 1080,
  aspectRatio: "16:9",
  fps: 60,
  backgroundFillColor: "#223344",
} as const;

describe("createTimelineRenderPlan", () => {
  it("translates timeline clips to render segments without mixing timeline position and source trim", () => {
    const editSpec = editSpecV1Schema.parse({
      version: "1",
      timeline: {
        exportSettings,
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
      exportSettings,
      segments: [
        {
          type: "clip",
          exportSettings,
          clipId: "clip-1",
          sourceVideoId: videoId,
          timelineStartMs: 0,
          timelineEndMs: 3000,
          trimStartMs: 2000,
          trimEndMs: 5000,
          durationMs: 3000,
        },
        {
          type: "clip",
          exportSettings,
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

  it("converts timeline gaps into black filler segments", () => {
    const editSpec = editSpecV1Schema.parse({
      version: "1",
      timeline: {
        exportSettings,
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
                trimStartMs: 0,
                trimEndMs: 1000,
                durationMs: 1000,
              },
              {
                id: "clip-2",
                assetId: "asset-2",
                videoId,
                positionMs: 2500,
                trimStartMs: 5000,
                trimEndMs: 6000,
                durationMs: 1000,
              },
            ],
          },
        ],
      },
    });

    expect(createTimelineRenderPlan(editSpec).segments).toEqual([
      expect.objectContaining({
        type: "clip",
        exportSettings,
        clipId: "clip-1",
        timelineStartMs: 0,
        timelineEndMs: 1000,
      }),
      {
        type: "filler",
        exportSettings,
        fillerId: "gap-1",
        timelineStartMs: 1000,
        timelineEndMs: 2500,
        durationMs: 1500,
        fill: {
          kind: "black",
          color: "#223344",
        },
      },
      expect.objectContaining({
        type: "clip",
        exportSettings,
        clipId: "clip-2",
        timelineStartMs: 2500,
        timelineEndMs: 3500,
      }),
    ]);
  });
});
