import { z } from "zod";
import type { EditSpecV1 } from "../edit-specs/edit-spec-v1.schema";

export const clipRenderSegmentSchema = z.object({
  type: z.literal("clip"),
  clipId: z.string().min(1),
  sourceVideoId: z.string().uuid(),
  timelineStartMs: z.number().int().min(0),
  timelineEndMs: z.number().int().positive(),
  trimStartMs: z.number().int().min(0),
  trimEndMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
});

export const fillerRenderSegmentSchema = z.object({
  type: z.literal("filler"),
  fillerId: z.string().min(1),
  timelineStartMs: z.number().int().min(0),
  timelineEndMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  fill: z.object({
    kind: z.literal("black"),
    color: z.literal("#000000"),
  }),
});

export const renderSegmentSchema = z.discriminatedUnion("type", [clipRenderSegmentSchema, fillerRenderSegmentSchema]);

export const timelineRenderPlanSchema = z.object({
  type: z.literal("timeline-render-plan-v1"),
  segments: z.array(renderSegmentSchema).min(1),
});

export type TimelineRenderPlan = z.infer<typeof timelineRenderPlanSchema>;
export type TimelineRenderSegment = TimelineRenderPlan["segments"][number];

export function createTimelineRenderPlan(editSpec: EditSpecV1): TimelineRenderPlan {
  const segments: TimelineRenderSegment[] = [];
  let cursorMs = 0;

  for (const clip of editSpec.timeline.tracks[0].clips) {
    if (clip.positionMs > cursorMs) {
      segments.push({
        type: "filler",
        fillerId: `gap-${segments.length}`,
        timelineStartMs: cursorMs,
        timelineEndMs: clip.positionMs,
        durationMs: clip.positionMs - cursorMs,
        fill: {
          kind: "black",
          color: "#000000",
        },
      });
    }

    segments.push({
      type: "clip",
      clipId: clip.id,
      sourceVideoId: clip.videoId,
      timelineStartMs: clip.positionMs,
      timelineEndMs: clip.positionMs + clip.durationMs,
      trimStartMs: clip.trimStartMs,
      trimEndMs: clip.trimEndMs,
      durationMs: clip.durationMs,
    });
    cursorMs = clip.positionMs + clip.durationMs;
  }

  return {
    type: "timeline-render-plan-v1",
    segments,
  };
}
