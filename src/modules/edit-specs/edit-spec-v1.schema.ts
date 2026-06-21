import { z } from "zod";

export const EDIT_SPEC_V1_VERSION = "1";
export const EXPORT_RESOLUTION_PRESETS = ["720p", "1080p", "4K"] as const;
export const EXPORT_ASPECT_RATIOS = ["9:16", "16:9", "1:1", "4:5"] as const;
export const EXPORT_FPS_VALUES = [24, 30, 60] as const;

const exportSettingsSchema = z
  .object({
    resolutionPreset: z.enum(EXPORT_RESOLUTION_PRESETS),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.enum(EXPORT_ASPECT_RATIOS),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    backgroundFillColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .superRefine((settings, context) => {
    const expectedLongEdgeByPreset = {
      "720p": 1280,
      "1080p": 1920,
      "4K": 3840,
    } satisfies Record<(typeof EXPORT_RESOLUTION_PRESETS)[number], number>;

    if (Math.max(settings.width, settings.height) !== expectedLongEdgeByPreset[settings.resolutionPreset]) {
      context.addIssue({
        code: "custom",
        message: "width and height must match resolutionPreset long edge",
        path: ["resolutionPreset"],
      });
    }

    if (settings.width % 2 !== 0) {
      context.addIssue({
        code: "custom",
        message: "width must be even",
        path: ["width"],
      });
    }

    if (settings.height % 2 !== 0) {
      context.addIssue({
        code: "custom",
        message: "height must be even",
        path: ["height"],
      });
    }

    const expectedAspectRatioByName = {
      "9:16": [9, 16],
      "16:9": [16, 9],
      "1:1": [1, 1],
      "4:5": [4, 5],
    } satisfies Record<(typeof EXPORT_ASPECT_RATIOS)[number], [number, number]>;
    const [ratioWidth, ratioHeight] = expectedAspectRatioByName[settings.aspectRatio];

    if (settings.width * ratioHeight !== settings.height * ratioWidth) {
      context.addIssue({
        code: "custom",
        message: "width and height must match aspectRatio",
        path: ["aspectRatio"],
      });
    }
  });

const clipTimingSchema = z
  .object({
    id: z.string().min(1),
    assetId: z.string().min(1).optional(),
    videoId: z.string().uuid(),
    positionMs: z.number().int().min(0),
    trimStartMs: z.number().int().min(0),
    trimEndMs: z.number().int().min(0),
    durationMs: z.number().int().positive(),
  })
  .superRefine((clip, context) => {
    if (clip.trimEndMs <= clip.trimStartMs) {
      context.addIssue({
        code: "custom",
        message: "trimEndMs must be greater than trimStartMs",
        path: ["trimEndMs"],
      });
    }

    if (clip.durationMs !== clip.trimEndMs - clip.trimStartMs) {
      context.addIssue({
        code: "custom",
        message: "durationMs must equal trimEndMs - trimStartMs",
        path: ["durationMs"],
      });
    }
  });

const videoTrackSchema = z.object({
  id: z.string().min(1),
  type: z.literal("video"),
  clips: z.array(clipTimingSchema).min(1),
});

export const editSpecV1Schema = z
  .object({
    version: z.literal(EDIT_SPEC_V1_VERSION),
    timeline: z.object({
      exportSettings: exportSettingsSchema,
      tracks: z.array(videoTrackSchema).length(1),
    }),
  })
  .superRefine((editSpec, context) => {
    const clips = editSpec.timeline.tracks[0]?.clips ?? [];

    if (clips[0]?.positionMs !== 0) {
      context.addIssue({
        code: "custom",
        message: "first clip must start at positionMs 0",
        path: ["timeline", "tracks", 0, "clips", 0, "positionMs"],
      });
    }

    for (let index = 1; index < clips.length; index += 1) {
      const previousClip = clips[index - 1];
      const clip = clips[index];
      const previousEndMs = previousClip.positionMs + previousClip.durationMs;

      if (clip.positionMs < previousClip.positionMs) {
        context.addIssue({
          code: "custom",
          message: "clips must be sorted by positionMs",
          path: ["timeline", "tracks", 0, "clips", index, "positionMs"],
        });
      }

      if (clip.positionMs < previousEndMs) {
        context.addIssue({
          code: "custom",
          message: "clips must not overlap",
          path: ["timeline", "tracks", 0, "clips", index, "positionMs"],
        });
      }
    }
  });

export type EditSpecV1 = z.infer<typeof editSpecV1Schema>;
export type EditSpecV1Clip = EditSpecV1["timeline"]["tracks"][number]["clips"][number];
export type EditSpecV1ExportSettings = EditSpecV1["timeline"]["exportSettings"];
export type EditSpecV1RenderSegment = {
  type: "clip";
  clipId: string;
  sourceVideoId: string;
  timelineStartMs: number;
  timelineEndMs: number;
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
};

export function createRenderSegmentsFromEditSpecV1(editSpec: EditSpecV1): EditSpecV1RenderSegment[] {
  return editSpec.timeline.tracks[0].clips.map((clip) => ({
    type: "clip",
    clipId: clip.id,
    sourceVideoId: clip.videoId,
    timelineStartMs: clip.positionMs,
    timelineEndMs: clip.positionMs + clip.durationMs,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
    durationMs: clip.durationMs,
  }));
}
