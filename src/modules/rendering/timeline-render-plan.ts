import { z } from "zod";
import type { EditSpecV1 } from "../edit-specs/edit-spec-v1.schema";
import { createRenderSegmentsFromEditSpecV1 } from "../edit-specs/edit-spec-v1.schema";

export const renderSegmentSchema = z.object({
  clipId: z.string().min(1),
  sourceVideoId: z.string().uuid(),
  timelineStartMs: z.number().int().min(0),
  timelineEndMs: z.number().int().positive(),
  trimStartMs: z.number().int().min(0),
  trimEndMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
});

export const timelineRenderPlanSchema = z.object({
  type: z.literal("timeline-render-plan-v1"),
  segments: z.array(renderSegmentSchema).min(1),
});

export type TimelineRenderPlan = z.infer<typeof timelineRenderPlanSchema>;
export type TimelineRenderSegment = TimelineRenderPlan["segments"][number];

export function createTimelineRenderPlan(editSpec: EditSpecV1): TimelineRenderPlan {
  return {
    type: "timeline-render-plan-v1",
    segments: createRenderSegmentsFromEditSpecV1(editSpec),
  };
}
