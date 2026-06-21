import path from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import type { Renderer } from "./renderer.interface";
import type { RenderInput } from "./rendering.types";
import { checkFfmpegAvailability, runFfmpeg } from "./ffmpeg.utils";
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
  now?: () => number;
};

export class FFmpegRenderer implements Renderer {
  private readonly checkAvailability: () => Promise<boolean>;
  private readonly executeFfmpeg: (args: string[]) => Promise<void>;
  private readonly createWorkspace: (path: string) => Promise<unknown>;
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

    const trimConfig = trimConfigSchema.parse(input.inputConfig);

    if (trimConfig.trim.start >= trimConfig.trim.end) {
      throw new Error("Invalid trim range: trim.start must be less than trim.end");
    }

    const startedAt = this.now();
    const workspacePath = getEditJobWorkspacePath(input.editJobId);
    const localOutputPath = path.join(workspacePath, "output.mp4");
    const ffmpegArgs = [
      "-y",
      "-i",
      localTestVideoPath,
      "-ss",
      String(trimConfig.trim.start),
      "-to",
      String(trimConfig.trim.end),
      "-c",
      "copy",
      localOutputPath,
    ];

    await this.createWorkspace(workspacePath);
    await this.executeFfmpeg(ffmpegArgs);

    return {
      outputStorageKey: `outputs/${input.userId}/${input.editJobId}.mp4`,
      durationMs: this.now() - startedAt,
      metadata: {
        renderer: "ffmpeg",
        localOutputPath,
      },
    };
  }
}
