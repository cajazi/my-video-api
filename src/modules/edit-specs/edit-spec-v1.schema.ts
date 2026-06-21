import { z } from "zod";

export const EDIT_SPEC_V1_VERSION = "1";

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

export function getFirstVideoClip(editSpec: EditSpecV1): EditSpecV1Clip {
  const firstTrack = editSpec.timeline.tracks[0];
  const firstClip = firstTrack?.clips[0];

  if (!firstClip) {
    throw new Error("Edit spec V1 requires at least one video clip");
  }

  return firstClip;
}

export function createTrimInputFromEditSpecV1(editSpec: EditSpecV1) {
  const firstClip = getFirstVideoClip(editSpec);

  return {
    trim: {
      start: firstClip.trimStartMs / 1000,
      end: firstClip.trimEndMs / 1000,
    },
  };
}

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
