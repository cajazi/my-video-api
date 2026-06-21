import { z } from "zod";
import type { EditSpecV1 } from "../edit-specs/edit-spec-v1.schema";

export const exportSettingsSchema = z.object({
  resolutionPreset: z.enum(["720p", "1080p", "4K"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  backgroundFillColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const clipRenderSegmentSchema = z.object({
  type: z.literal("clip"),
  exportSettings: exportSettingsSchema,
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
  exportSettings: exportSettingsSchema,
  fillerId: z.string().min(1),
  timelineStartMs: z.number().int().min(0),
  timelineEndMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  fill: z.object({
    kind: z.literal("black"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
});

export const renderSegmentSchema = z.discriminatedUnion("type", [clipRenderSegmentSchema, fillerRenderSegmentSchema]);

export const timelineRenderPlanSchema = z.object({
  type: z.literal("timeline-render-plan-v1"),
  exportSettings: exportSettingsSchema,
  segments: z.array(renderSegmentSchema).min(1),
});

export type TimelineRenderPlan = z.infer<typeof timelineRenderPlanSchema>;
export type TimelineRenderSegment = TimelineRenderPlan["segments"][number];
export type TimelineExportSettings = TimelineRenderPlan["exportSettings"];

export function createTimelineRenderPlan(editSpec: EditSpecV1): TimelineRenderPlan {
  const segments: TimelineRenderSegment[] = [];
  let cursorMs = 0;
  const exportSettings = editSpec.timeline.exportSettings;

  for (const clip of editSpec.timeline.tracks[0].clips) {
    if (clip.positionMs > cursorMs) {
      segments.push({
        type: "filler",
        exportSettings,
        fillerId: `gap-${segments.length}`,
        timelineStartMs: cursorMs,
        timelineEndMs: clip.positionMs,
        durationMs: clip.positionMs - cursorMs,
        fill: {
          kind: "black",
          color: exportSettings.backgroundFillColor,
        },
      });
    }

    segments.push({
      type: "clip",
      exportSettings,
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
    exportSettings,
    segments,
  };
}
