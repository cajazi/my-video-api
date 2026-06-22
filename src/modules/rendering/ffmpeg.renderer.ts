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

type AudioRenderClip = NonNullable<TimelineRenderPlan["audioTracks"]>[number]["clips"][number];
type DipTransitionType = "dip_to_black" | "dip_to_white";
type SlideTransitionType = "slide_left" | "slide_right";
type ZoomTransitionType = "zoom_in" | "zoom_out";
type RenderedTransitionType = "dissolve" | DipTransitionType | SlideTransitionType | ZoomTransitionType;

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
    const hasAudioTracks = this.hasAudioTracks(renderPlan);
    const videoOutputPath = hasAudioTracks ? path.join(workspacePath, "video-output.mp4") : localOutputPath;
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
    await this.concatSegments(concatListPath, videoOutputPath, renderPlan.exportSettings);

    if (hasAudioTracks) {
      const mixedAudioPath = path.join(workspacePath, "mixed-audio.m4a");
      await this.renderMixedAudio(localTestVideoPath, renderPlan, mixedAudioPath);
      await this.muxAudio(videoOutputPath, mixedAudioPath, localOutputPath);
    }

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

  private hasAudioTracks(renderPlan: TimelineRenderPlan) {
    return (renderPlan.audioTracks ?? []).some((track) => track.clips.length > 0);
  }

  private getVideoOutputDurationMs(renderPlan: TimelineRenderPlan) {
    const mediaDurationMs = renderPlan.segments
      .filter((segment) => segment.type === "clip" || segment.type === "filler")
      .reduce((total, segment) => total + segment.durationMs, 0);
    const transitionDurationMs = renderPlan.segments
      .filter((segment) => segment.type === "transition")
      .reduce((total, segment) => total + segment.outputTimelineDurationMs, 0);

    return mediaDurationMs - transitionDurationMs;
  }

  private getAudioClips(renderPlan: TimelineRenderPlan): AudioRenderClip[] {
    return (renderPlan.audioTracks ?? []).flatMap((track) => track.clips);
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
          const transitionType = transition.transitionType;

          if (!this.isRenderedTransition(transition)) {
            throw new Error(`Unsupported transition renderer: ${transitionType}`);
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
    return (
      transition.transitionType === "dissolve" ||
      this.isDipTransition(transition) ||
      this.isSlideTransition(transition) ||
      this.isZoomTransition(transition)
    );
  }

  private isDipTransition(transition: TransitionRenderOperation): transition is TransitionRenderOperation & {
    transitionType: DipTransitionType;
  } {
    return transition.transitionType === "dip_to_black" || transition.transitionType === "dip_to_white";
  }

  private isSlideTransition(transition: TransitionRenderOperation): transition is TransitionRenderOperation & {
    transitionType: SlideTransitionType;
  } {
    return transition.transitionType === "slide_left" || transition.transitionType === "slide_right";
  }

  private isZoomTransition(transition: TransitionRenderOperation): transition is TransitionRenderOperation & {
    transitionType: ZoomTransitionType;
  } {
    return transition.transitionType === "zoom_in" || transition.transitionType === "zoom_out";
  }

  private getDipColor(transitionType: DipTransitionType) {
    return transitionType === "dip_to_black" ? "0x000000" : "0xFFFFFF";
  }

  private getSlideXExpression(transitionType: SlideTransitionType, durationSeconds: number) {
    return transitionType === "slide_left"
      ? `W-W*t/${durationSeconds}`
      : `-W+W*t/${durationSeconds}`;
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
      } else if (this.isDipTransition(transition)) {
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
      } else if (this.isSlideTransition(transition)) {
        const durationSeconds = transition.durationMs / 1000;
        const slideXExpression = this.getSlideXExpression(transition.transitionType, durationSeconds);

        filters.push(
          `[v${index}]trim=start=${(fromClip.durationMs - transition.durationMs) / 1000}:end=${fromClip.durationMs / 1000},setpts=PTS-STARTPTS[out${index}]`,
          `[v${index + 1}]trim=start=0:end=${durationSeconds},setpts=PTS-STARTPTS[in${index}]`,
          `[out${index}][in${index}]overlay=x='${slideXExpression}':y=0:shortest=1[${transitionLabel}]`,
        );
      } else if (this.isZoomTransition(transition)) {
        const durationSeconds = transition.durationMs / 1000;
        const outgoingScaleExpression =
          transition.transitionType === "zoom_in"
            ? `1-0.2*t/${durationSeconds}`
            : `1+0.2*t/${durationSeconds}`;
        const incomingScaleExpression =
          transition.transitionType === "zoom_in"
            ? `1.2-0.2*t/${durationSeconds}`
            : `0.8+0.2*t/${durationSeconds}`;

        filters.push(
          `[v${index}]trim=start=${(fromClip.durationMs - transition.durationMs) / 1000}:end=${fromClip.durationMs / 1000},setpts=PTS-STARTPTS[out${index}]`,
          `[v${index + 1}]trim=start=0:end=${durationSeconds},setpts=PTS-STARTPTS[in${index}]`,
          `[out${index}]scale=w='trunc(iw*(${outgoingScaleExpression})/2)*2':h='trunc(ih*(${outgoingScaleExpression})/2)*2':eval=frame,setsar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,crop=${width}:${height}[outzoom${index}]`,
          `[in${index}]scale=w='trunc(iw*(${incomingScaleExpression})/2)*2':h='trunc(ih*(${incomingScaleExpression})/2)*2':eval=frame,setsar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,crop=${width}:${height}[inzoom${index}]`,
          `[outzoom${index}][inzoom${index}]blend=all_expr='A*(1-T/${durationSeconds})+B*(T/${durationSeconds})'[${transitionLabel}]`,
        );
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

  private async renderMixedAudio(sourcePath: string, renderPlan: TimelineRenderPlan, outputPath: string) {
    const audioClips = this.getAudioClips(renderPlan);
    const videoDurationSeconds = this.getVideoOutputDurationMs(renderPlan) / 1000;
    const inputArgs = audioClips.flatMap(() => ["-i", sourcePath]);
    const clipFilters = audioClips.map((clip, index) => {
      const fadeInFilter = clip.fadeInMs ? `,afade=t=in:st=0:d=${clip.fadeInMs / 1000}` : "";
      const fadeOutFilter = clip.fadeOutMs
        ? `,afade=t=out:st=${(clip.durationMs - clip.fadeOutMs) / 1000}:d=${clip.fadeOutMs / 1000}`
        : "";

      return (
        `[${index}:a]atrim=start=${clip.trimStartMs / 1000}:end=${clip.trimEndMs / 1000},` +
        `asetpts=PTS-STARTPTS,volume=${clip.volume}${fadeInFilter}${fadeOutFilter},` +
        `adelay=${clip.positionMs}|${clip.positionMs}[a${index}]`
      );
    });
    const mixedInputLabels = audioClips.map((_, index) => `[a${index}]`).join("");
    const mixFilter =
      audioClips.length === 1
        ? `[a0]apad,atrim=0:${videoDurationSeconds},asetpts=PTS-STARTPTS[a]`
        : `${mixedInputLabels}amix=inputs=${audioClips.length}:duration=longest:normalize=0,apad,atrim=0:${videoDurationSeconds},asetpts=PTS-STARTPTS[a]`;

    await this.executeFfmpeg([
      "-y",
      ...inputArgs,
      "-filter_complex",
      `${clipFilters.join(";")};${mixFilter}`,
      "-map",
      "[a]",
      "-vn",
      "-c:a",
      "aac",
      outputPath,
    ]);
  }

  private async muxAudio(videoPath: string, audioPath: string, outputPath: string) {
    await this.executeFfmpeg([
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      outputPath,
    ]);
  }

  private createConcatList(segmentOutputPaths: string[]) {
    return segmentOutputPaths.map((segmentPath) => `file '${segmentPath.replaceAll("'", "'\\''")}'`).join("\n");
  }
}
