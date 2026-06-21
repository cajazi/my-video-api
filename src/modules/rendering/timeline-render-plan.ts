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

export const transitionRenderOperationSchema = z.object({
  type: z.literal("transition"),
  exportSettings: exportSettingsSchema,
  transitionId: z.string().min(1),
  transitionType: z.enum([
    "dissolve",
    "dip_to_black",
    "dip_to_white",
    "slide_left",
    "slide_right",
    "zoom_in",
    "zoom_out",
  ]),
  fromClipId: z.string().min(1),
  toClipId: z.string().min(1),
  timelineStartMs: z.number().int().min(0),
  durationMs: z.number().int().positive(),
  outputTimelineDurationMs: z.number().int().positive(),
});

export const renderSegmentSchema = z.discriminatedUnion("type", [
  clipRenderSegmentSchema,
  fillerRenderSegmentSchema,
  transitionRenderOperationSchema,
]);

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
  const transitionsByFromClipId = new Map(
    editSpec.timeline.transitions.map((transition) => [transition.fromClipId, transition]),
  );

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

    const transition = transitionsByFromClipId.get(clip.id);

    if (transition) {
      segments.push({
        type: "transition",
        exportSettings,
        transitionId: transition.id,
        transitionType: transition.type,
        fromClipId: transition.fromClipId,
        toClipId: transition.toClipId,
        timelineStartMs: clip.positionMs + clip.durationMs,
        durationMs: transition.durationMs,
        outputTimelineDurationMs: transition.durationMs,
      });
    }

    cursorMs = clip.positionMs + clip.durationMs;
  }

  return {
    type: "timeline-render-plan-v1",
    exportSettings,
    segments,
  };
}
