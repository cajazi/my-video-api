import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Renderer } from "./renderer.interface";
import type { RenderInput } from "./rendering.types";
import { createRenderOutputStorageKey } from "../storage/media-storage.paths";
import { checkFfmpegAvailability, runFfmpeg } from "./ffmpeg.utils";
import {
  timelineRenderPlanSchema,
  type TimelineRenderPlan,
  type TimelineRenderSegment,
} from "./timeline-render-plan";
import { getEditJobWorkspacePath } from "./workspace.util";

const trimConfigSchema = z.object({
  trim: z.object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
  }),
});

type FFmpegRendererDependencies = {
  localTestVideoPath: string;
  checkAvailability?: () => Promise<boolean>;
  executeFfmpeg?: (args: string[]) => Promise<void>;
  createWorkspace?: (path: string) => Promise<unknown>;
  writeConcatList?: (path: string, content: string) => Promise<void>;
  now?: () => number;
};

export class FFmpegRenderer implements Renderer {
  private readonly checkAvailability: () => Promise<boolean>;
  private readonly executeFfmpeg: (args: string[]) => Promise<void>;
  private readonly createWorkspace: (path: string) => Promise<unknown>;
  private readonly writeConcatList: (path: string, content: string) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly dependencies: FFmpegRendererDependencies) {
    this.checkAvailability = dependencies.checkAvailability ?? checkFfmpegAvailability;
    this.executeFfmpeg = dependencies.executeFfmpeg ?? runFfmpeg;
    this.createWorkspace =
      dependencies.createWorkspace ??
      ((workspacePath) =>
        mkdir(workspacePath, {
          recursive: true,
        }));
    this.writeConcatList = dependencies.writeConcatList ?? writeFile;
    this.now = dependencies.now ?? Date.now;
  }

  async render(input: RenderInput) {
    const localTestVideoPath = this.dependencies.localTestVideoPath.trim();

    if (!localTestVideoPath) {
      throw new Error("LOCAL_TEST_VIDEO_PATH is required for FFmpeg rendering");
    }

    if (!(await this.checkAvailability())) {
      throw new Error("FFmpeg is not available");
    }

    const renderPlan = this.parseRenderPlan(input.inputConfig);

    const startedAt = this.now();
    const workspacePath = getEditJobWorkspacePath(input.editJobId);
    const localOutputPath = path.join(workspacePath, "output.mp4");
    const segmentOutputPaths = renderPlan.segments.map((_, index) =>
      path.join(workspacePath, `segment-${String(index).padStart(3, "0")}.mp4`),
    );
    const concatListPath = path.join(workspacePath, "concat-list.txt");

    await this.createWorkspace(workspacePath);

    for (const [index, segment] of renderPlan.segments.entries()) {
      await this.renderSegment(localTestVideoPath, segment, segmentOutputPaths[index]);
    }

    await this.writeConcatList(concatListPath, this.createConcatList(segmentOutputPaths));
    await this.concatSegments(concatListPath, localOutputPath);

    return {
      outputStorageKey: createRenderOutputStorageKey(input),
      localOutputPath,
      durationMs: this.now() - startedAt,
      metadata: {
        renderer: "ffmpeg",
        segmentCount: renderPlan.segments.length,
        localOutputPath,
      },
    };
  }

  private parseRenderPlan(inputConfig: RenderInput["inputConfig"]): TimelineRenderPlan {
    const timelineRenderPlan = timelineRenderPlanSchema.safeParse(inputConfig);

    if (timelineRenderPlan.success) {
      return timelineRenderPlan.data;
    }

    const trimConfig = trimConfigSchema.parse(inputConfig);

    if (trimConfig.trim.start >= trimConfig.trim.end) {
      throw new Error("Invalid trim range: trim.start must be less than trim.end");
    }

    return {
      type: "timeline-render-plan-v1",
      segments: [
        {
          clipId: "legacy-trim",
          sourceVideoId: "00000000-0000-0000-0000-000000000000",
          timelineStartMs: 0,
          timelineEndMs: Math.round((trimConfig.trim.end - trimConfig.trim.start) * 1000),
          trimStartMs: Math.round(trimConfig.trim.start * 1000),
          trimEndMs: Math.round(trimConfig.trim.end * 1000),
          durationMs: Math.round((trimConfig.trim.end - trimConfig.trim.start) * 1000),
          type: "clip",
        },
      ],
    };
  }

  private async renderSegment(sourcePath: string, segment: TimelineRenderSegment, outputPath: string) {
    if (segment.type === "filler") {
      await this.renderBlackFiller(segment, outputPath);
      return;
    }

    await this.trimSegment(sourcePath, segment, outputPath);
  }

  private async trimSegment(
    sourcePath: string,
    segment: Extract<TimelineRenderSegment, { type: "clip" }>,
    outputPath: string,
  ) {
    await this.executeFfmpeg([
      "-y",
      "-i",
      sourcePath,
      "-ss",
      String(segment.trimStartMs / 1000),
      "-to",
      String(segment.trimEndMs / 1000),
      "-c",
      "copy",
      outputPath,
    ]);
  }

  private async renderBlackFiller(segment: Extract<TimelineRenderSegment, { type: "filler" }>, outputPath: string) {
    await this.executeFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=1280x720:r=30:d=${segment.durationMs / 1000}`,
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ]);
  }

  private async concatSegments(concatListPath: string, outputPath: string) {
    await this.executeFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", outputPath]);
  }

  private createConcatList(segmentOutputPaths: string[]) {
    return segmentOutputPaths.map((segmentPath) => `file '${segmentPath.replaceAll("'", "'\\''")}'`).join("\n");
  }
}
