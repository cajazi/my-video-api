import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Renderer } from "./renderer.interface";
import type { RenderInput } from "./rendering.types";
import { createRenderOutputStorageKey } from "../storage/media-storage.paths";
import { checkFfmpegAvailability, runFfmpeg } from "./ffmpeg.utils";
import {
  type TimelineExportSettings,
  timelineRenderPlanSchema,
  type TimelineRenderPlan,
  type TimelineRenderSegment,
} from "./timeline-render-plan";
import { getEditJobWorkspacePath } from "./workspace.util";

type MediaRenderSegment = Exclude<TimelineRenderSegment, { type: "transition" }>;
type ClipRenderSegment = Extract<TimelineRenderSegment, { type: "clip" }>;
type TransitionRenderOperation = Extract<TimelineRenderSegment, { type: "transition" }>;

type RenderedMediaEntry = {
  segment: MediaRenderSegment;
  outputPath: string;
};

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
    const mediaSegments = renderPlan.segments.filter((segment): segment is MediaRenderSegment => segment.type !== "transition");
    const segmentOutputPaths = mediaSegments.map((_, index) =>
      path.join(workspacePath, `segment-${String(index).padStart(3, "0")}.mp4`),
    );
    const concatListPath = path.join(workspacePath, "concat-list.txt");

    await this.createWorkspace(workspacePath);

    const renderedMediaEntries: RenderedMediaEntry[] = [];

    for (const [index, segment] of mediaSegments.entries()) {
      await this.renderSegment(localTestVideoPath, segment, segmentOutputPaths[index]);
      renderedMediaEntries.push({
        segment,
        outputPath: segmentOutputPaths[index],
      });
    }

    const physicalOutputPaths = await this.createPhysicalOutputPaths(renderPlan, renderedMediaEntries, workspacePath);

    await this.writeConcatList(concatListPath, this.createConcatList(physicalOutputPaths));
    await this.concatSegments(concatListPath, localOutputPath, renderPlan.exportSettings);

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
    return timelineRenderPlanSchema.parse(inputConfig);
  }

  private async renderSegment(sourcePath: string, segment: MediaRenderSegment, outputPath: string) {
    if (segment.type === "filler") {
      await this.renderBlackFiller(segment, outputPath);
      return;
    }

    await this.trimSegment(sourcePath, segment, outputPath);
  }

  private async trimSegment(
    sourcePath: string,
    segment: ClipRenderSegment,
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
    const { width, height, fps } = segment.exportSettings;
    const color = segment.fill.color.replace("#", "0x");

    await this.executeFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${width}x${height}:r=${fps}:d=${segment.durationMs / 1000}`,
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ]);
  }

  private async createPhysicalOutputPaths(
    renderPlan: TimelineRenderPlan,
    renderedMediaEntries: RenderedMediaEntry[],
    workspacePath: string,
  ) {
    const mediaByClipId = new Map(
      renderedMediaEntries
        .filter((entry): entry is RenderedMediaEntry & { segment: ClipRenderSegment } => entry.segment.type === "clip")
        .map((entry) => [entry.segment.clipId, entry]),
    );
    const mediaBySegment = new Map(renderedMediaEntries.map((entry) => [entry.segment, entry.outputPath]));
    const physicalOutputPaths: string[] = [];
    const consumedClipIds = new Set<string>();
    const transitionFromClipIds = new Set(
      renderPlan.segments
        .filter((segment): segment is TransitionRenderOperation => segment.type === "transition")
        .map((segment) => segment.fromClipId),
    );
    let dissolveIndex = 0;

    for (const segment of renderPlan.segments) {
      if (segment.type === "transition") {
        if (segment.transitionType !== "dissolve") {
          throw new Error(`Unsupported transition renderer: ${segment.transitionType}`);
        }

        const fromEntry = mediaByClipId.get(segment.fromClipId);
        const toEntry = mediaByClipId.get(segment.toClipId);

        if (!fromEntry || !toEntry) {
          throw new Error("Dissolve transition requires rendered adjacent clip media");
        }

        const outputPath = path.join(workspacePath, `dissolve-${String(dissolveIndex).padStart(3, "0")}.mp4`);
        await this.renderDissolveTransition(fromEntry, toEntry, segment, outputPath);
        physicalOutputPaths.push(outputPath);
        consumedClipIds.add(segment.fromClipId);
        consumedClipIds.add(segment.toClipId);
        dissolveIndex += 1;
        continue;
      }

      if (segment.type === "clip" && consumedClipIds.has(segment.clipId)) {
        continue;
      }

      if (segment.type === "clip" && transitionFromClipIds.has(segment.clipId)) {
        continue;
      }

      const outputPath = mediaBySegment.get(segment);

      if (outputPath) {
        physicalOutputPaths.push(outputPath);
      }
    }

    return physicalOutputPaths;
  }

  private async renderDissolveTransition(
    fromEntry: RenderedMediaEntry & { segment: ClipRenderSegment },
    toEntry: RenderedMediaEntry & { segment: ClipRenderSegment },
    transition: TransitionRenderOperation,
    outputPath: string,
  ) {
    const { width, height, fps } = transition.exportSettings;
    const durationSeconds = transition.durationMs / 1000;
    const offsetSeconds = (fromEntry.segment.durationMs - transition.durationMs) / 1000;

    await this.executeFfmpeg([
      "-y",
      "-i",
      fromEntry.outputPath,
      "-i",
      toEntry.outputPath,
      "-filter_complex",
      `[0:v]scale=${width}:${height},fps=${fps},format=yuv420p[v0];[1:v]scale=${width}:${height},fps=${fps},format=yuv420p[v1];[v0][v1]xfade=transition=fade:duration=${durationSeconds}:offset=${offsetSeconds}[v]`,
      "-map",
      "[v]",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ]);
  }

  private async concatSegments(
    concatListPath: string,
    outputPath: string,
    exportSettings: TimelineExportSettings,
  ) {
    await this.executeFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-vf",
      `scale=${exportSettings.width}:${exportSettings.height},fps=${exportSettings.fps}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outputPath,
    ]);
  }

  private createConcatList(segmentOutputPaths: string[]) {
    return segmentOutputPaths.map((segmentPath) => `file '${segmentPath.replaceAll("'", "'\\''")}'`).join("\n");
  }
}
