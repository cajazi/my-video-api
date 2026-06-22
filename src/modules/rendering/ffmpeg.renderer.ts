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

type RenderedClipEntry = RenderedMediaEntry & {
  segment: ClipRenderSegment;
};

type DipTransitionType = "dip_to_black" | "dip_to_white";

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
    let transitionIndex = 0;

    for (let index = 0; index < renderPlan.segments.length; index += 1) {
      const segment = renderPlan.segments[index];

      if (segment.type === "transition") {
        throw new Error(`Transition operation is missing outgoing clip media: ${segment.transitionId}`);
      }

      if (segment.type === "clip" && renderPlan.segments[index + 1]?.type === "transition") {
        const firstTransition = renderPlan.segments[index + 1] as TransitionRenderOperation;

        if (this.isDipTransition(firstTransition)) {
          if (renderPlan.segments[index + 3]?.type === "transition") {
            throw new Error(`Unsupported transition renderer: ${firstTransition.transitionType}`);
          }

          const fromEntry = mediaByClipId.get(firstTransition.fromClipId);
          const toEntry = mediaByClipId.get(firstTransition.toClipId);

          if (!fromEntry || !toEntry) {
            throw new Error("Dip transition requires rendered adjacent clip media");
          }

          const outputPath = path.join(workspacePath, `dip-${String(transitionIndex).padStart(3, "0")}.mp4`);
          await this.renderDipBoundary(fromEntry, toEntry, firstTransition, outputPath);
          physicalOutputPaths.push(outputPath);
          transitionIndex += 1;
          index += 2;
          continue;
        }

        const chainClipEntries: RenderedClipEntry[] = [];
        const chainTransitions: TransitionRenderOperation[] = [];
        let cursor = index;
        const firstEntry = mediaByClipId.get(segment.clipId);

        if (!firstEntry) {
          throw new Error("Dissolve transition requires rendered adjacent clip media");
        }

        chainClipEntries.push(firstEntry);

        while (renderPlan.segments[cursor + 1]?.type === "transition") {
          const transition = renderPlan.segments[cursor + 1] as TransitionRenderOperation;

          if (transition.transitionType !== "dissolve") {
            throw new Error(`Unsupported transition renderer: ${transition.transitionType}`);
          }

          const toEntry = mediaByClipId.get(transition.toClipId);

          if (!toEntry) {
            throw new Error("Dissolve transition requires rendered adjacent clip media");
          }

          chainTransitions.push(transition);
          chainClipEntries.push(toEntry);
          cursor += 2;
        }

        const outputPath = path.join(workspacePath, `dissolve-${String(transitionIndex).padStart(3, "0")}.mp4`);
        await this.renderDissolveChain(chainClipEntries, chainTransitions, outputPath);
        physicalOutputPaths.push(outputPath);
        transitionIndex += 1;
        index = cursor;
        continue;
      }

      const outputPath = mediaBySegment.get(segment);

      if (outputPath) {
        physicalOutputPaths.push(outputPath);
      }
    }

    return physicalOutputPaths;
  }

  private isDipTransition(transition: TransitionRenderOperation): transition is TransitionRenderOperation & {
    transitionType: DipTransitionType;
  } {
    return transition.transitionType === "dip_to_black" || transition.transitionType === "dip_to_white";
  }

  private getDipColor(transitionType: DipTransitionType) {
    return transitionType === "dip_to_black" ? "0x000000" : "0xFFFFFF";
  }

  private async renderDipBoundary(
    fromEntry: RenderedClipEntry,
    toEntry: RenderedClipEntry,
    transition: TransitionRenderOperation & { transitionType: DipTransitionType },
    outputPath: string,
  ) {
    const { width, height, fps } = transition.exportSettings;
    const halfDurationMs = transition.durationMs / 2;
    const halfDurationSeconds = halfDurationMs / 1000;
    const fromDurationSeconds = fromEntry.segment.durationMs / 1000;
    const toDurationSeconds = toEntry.segment.durationMs / 1000;
    const outgoingBodyEndSeconds = (fromEntry.segment.durationMs - halfDurationMs) / 1000;
    const color = this.getDipColor(transition.transitionType);
    const filter = [
      `[0:v]scale=${width}:${height},fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v0]`,
      `[1:v]scale=${width}:${height},fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v1]`,
      "[2:v]format=yuv420p,setpts=PTS-STARTPTS,split=2[colorout][colorin]",
      `[v0]trim=start=0:end=${outgoingBodyEndSeconds},setpts=PTS-STARTPTS[outbody]`,
      `[v0]trim=start=${outgoingBodyEndSeconds}:end=${fromDurationSeconds},setpts=PTS-STARTPTS[outtail]`,
      `[outtail][colorout]xfade=transition=fade:duration=${halfDurationSeconds}:offset=0[outfade]`,
      `[v1]trim=start=0:end=${halfDurationSeconds},setpts=PTS-STARTPTS[intail]`,
      `[colorin][intail]xfade=transition=fade:duration=${halfDurationSeconds}:offset=0[infade]`,
      `[v1]trim=start=${halfDurationSeconds}:end=${toDurationSeconds},setpts=PTS-STARTPTS[inbody]`,
      "[outbody][outfade][infade][inbody]concat=n=4:v=1:a=0[v]",
    ].join(";");

    await this.executeFfmpeg([
      "-y",
      "-i",
      fromEntry.outputPath,
      "-i",
      toEntry.outputPath,
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${width}x${height}:r=${fps}:d=${halfDurationSeconds}`,
      "-filter_complex",
      filter,
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

  private async renderDissolveChain(
    clipEntries: RenderedClipEntry[],
    transitions: TransitionRenderOperation[],
    outputPath: string,
  ) {
    const { width, height, fps } = transitions[0].exportSettings;
    const inputArgs = clipEntries.flatMap((entry) => ["-i", entry.outputPath]);
    const normalizedInputs = clipEntries
      .map((_, index) => `[${index}:v]scale=${width}:${height},fps=${fps},format=yuv420p[v${index}]`)
      .join(";");
    const xfadeFilters: string[] = [];
    let composedDurationMs = clipEntries[0].segment.durationMs;
    let previousLabel = "v0";

    for (const [index, transition] of transitions.entries()) {
      const nextLabel = `v${index + 1}`;
      const outputLabel = index === transitions.length - 1 ? "v" : `x${index + 1}`;
      const durationSeconds = transition.durationMs / 1000;
      const offsetSeconds = (composedDurationMs - transition.durationMs) / 1000;

      xfadeFilters.push(
        `[${previousLabel}][${nextLabel}]xfade=transition=fade:duration=${durationSeconds}:offset=${offsetSeconds}[${outputLabel}]`,
      );
      composedDurationMs = composedDurationMs + clipEntries[index + 1].segment.durationMs - transition.durationMs;
      previousLabel = outputLabel;
    }

    await this.executeFfmpeg([
      "-y",
      ...inputArgs,
      "-filter_complex",
      `${normalizedInputs};${xfadeFilters.join(";")}`,
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
