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
type RenderedTransitionType = "dissolve" | DipTransitionType;

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
        const chainClipEntries: RenderedClipEntry[] = [];
        const chainTransitions: (TransitionRenderOperation & { transitionType: RenderedTransitionType })[] = [];
        let cursor = index;
        const firstEntry = mediaByClipId.get(segment.clipId);

        if (!firstEntry) {
          throw new Error("Transition requires rendered adjacent clip media");
        }

        chainClipEntries.push(firstEntry);

        while (renderPlan.segments[cursor + 1]?.type === "transition") {
          const transition = renderPlan.segments[cursor + 1] as TransitionRenderOperation;

          if (!this.isRenderedTransition(transition)) {
            throw new Error(`Unsupported transition renderer: ${transition.transitionType}`);
          }

          const toEntry = mediaByClipId.get(transition.toClipId);

          if (!toEntry) {
            throw new Error("Transition requires rendered adjacent clip media");
          }

          chainTransitions.push(transition);
          chainClipEntries.push(toEntry);
          cursor += 2;
        }

        const isDissolveOnlyChain = chainTransitions.every((transition) => transition.transitionType === "dissolve");
        const outputPrefix = isDissolveOnlyChain
          ? "dissolve"
          : chainTransitions.length === 1 && this.isDipTransition(chainTransitions[0])
            ? "dip"
            : "transition-chain";
        const outputPath = path.join(workspacePath, `${outputPrefix}-${String(transitionIndex).padStart(3, "0")}.mp4`);

        if (isDissolveOnlyChain) {
          await this.renderDissolveChain(chainClipEntries, chainTransitions, outputPath);
        } else {
          await this.renderMixedTransitionChain(chainClipEntries, chainTransitions, outputPath);
        }

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

  private isRenderedTransition(transition: TransitionRenderOperation): transition is TransitionRenderOperation & {
    transitionType: RenderedTransitionType;
  } {
    return transition.transitionType === "dissolve" || this.isDipTransition(transition);
  }

  private isDipTransition(transition: TransitionRenderOperation): transition is TransitionRenderOperation & {
    transitionType: DipTransitionType;
  } {
    return transition.transitionType === "dip_to_black" || transition.transitionType === "dip_to_white";
  }

  private getDipColor(transitionType: DipTransitionType) {
    return transitionType === "dip_to_black" ? "0x000000" : "0xFFFFFF";
  }

  private async renderMixedTransitionChain(
    clipEntries: RenderedClipEntry[],
    transitions: (TransitionRenderOperation & { transitionType: RenderedTransitionType })[],
    outputPath: string,
  ) {
    const { width, height, fps } = transitions[0].exportSettings;
    const clipInputArgs = clipEntries.flatMap((entry) => ["-i", entry.outputPath]);
    const dipTransitions = transitions.filter((transition) => this.isDipTransition(transition));
    const colorInputArgs = dipTransitions.flatMap((transition) => {
      const color = this.getDipColor(transition.transitionType);

      return [
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=${width}x${height}:r=${fps}:d=${transition.durationMs / 2000}`,
      ];
    });
    const filters = clipEntries.map(
      (_, index) => `[${index}:v]scale=${width}:${height},fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${index}]`,
    );
    const concatLabels: string[] = [];
    let dipInputOffset = clipEntries.length;
    let dipIndex = 0;

    const pushClipBody = (clipIndex: number, startMs: number, endMs: number) => {
      if (endMs <= startMs) {
        return;
      }

      const label = `body${concatLabels.length}`;
      filters.push(
        `[v${clipIndex}]trim=start=${startMs / 1000}:end=${endMs / 1000},setpts=PTS-STARTPTS[${label}]`,
      );
      concatLabels.push(label);
    };

    pushClipBody(0, 0, clipEntries[0].segment.durationMs - transitions[0].durationMs);

    for (const [index, transition] of transitions.entries()) {
      const fromClip = clipEntries[index].segment;
      const toClip = clipEntries[index + 1].segment;
      const transitionLabel = `transition${index}`;

      if (transition.transitionType === "dissolve") {
        filters.push(
          `[v${index}]trim=start=${(fromClip.durationMs - transition.durationMs) / 1000}:end=${fromClip.durationMs / 1000},setpts=PTS-STARTPTS[out${index}]`,
          `[v${index + 1}]trim=start=0:end=${transition.durationMs / 1000},setpts=PTS-STARTPTS[in${index}]`,
          `[out${index}][in${index}]xfade=transition=fade:duration=${transition.durationMs / 1000}:offset=0[${transitionLabel}]`,
        );
      } else {
        const halfDurationMs = transition.durationMs / 2;
        const colorInputIndex = dipInputOffset;
        const colorOutLabel = `colorout${dipIndex}`;
        const colorInLabel = `colorin${dipIndex}`;

        filters.push(
          `[${colorInputIndex}:v]format=yuv420p,setpts=PTS-STARTPTS,split=2[${colorOutLabel}][${colorInLabel}]`,
          `[v${index}]trim=start=${(fromClip.durationMs - transition.durationMs) / 1000}:end=${(fromClip.durationMs - halfDurationMs) / 1000},setpts=PTS-STARTPTS[out${index}]`,
          `[out${index}][${colorOutLabel}]xfade=transition=fade:duration=${halfDurationMs / 1000}:offset=0[outfade${index}]`,
          `[v${index + 1}]trim=start=0:end=${halfDurationMs / 1000},setpts=PTS-STARTPTS[in${index}]`,
          `[${colorInLabel}][in${index}]xfade=transition=fade:duration=${halfDurationMs / 1000}:offset=0[infade${index}]`,
          `[outfade${index}][infade${index}]concat=n=2:v=1:a=0[${transitionLabel}]`,
        );

        dipInputOffset += 1;
        dipIndex += 1;
      }

      concatLabels.push(transitionLabel);

      const nextTransition = transitions[index + 1];
      pushClipBody(
        index + 1,
        transition.durationMs,
        toClip.durationMs - (nextTransition?.durationMs ?? 0),
      );
    }

    filters.push(`[${concatLabels.join("][")}]concat=n=${concatLabels.length}:v=1:a=0[v]`);

    await this.executeFfmpeg([
      "-y",
      ...clipInputArgs,
      ...colorInputArgs,
      "-filter_complex",
      filters.join(";"),
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
