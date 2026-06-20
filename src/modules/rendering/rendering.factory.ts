import type { PrismaClient } from "@prisma/client";
import type { env } from "../../config/env";
import { FFmpegRenderer } from "./ffmpeg.renderer";
import { checkFfmpegAvailability } from "./ffmpeg.utils";
import { MockRenderer } from "./mock.renderer";
import type { Renderer } from "./renderer.interface";
import { RenderingService } from "./rendering.service";

type RendererProvider = typeof env.RENDERER_PROVIDER;
type RenderingFactoryPrismaClient = Pick<PrismaClient, "editJob" | "video">;

export class RenderingFactory {
  constructor(
    private readonly prisma: RenderingFactoryPrismaClient,
    private readonly provider: RendererProvider,
  ) {}

  async createRenderingService() {
    return new RenderingService(this.prisma, await this.createRenderer());
  }

  async createRenderer(): Promise<Renderer> {
    if (this.provider === "mock") {
      return new MockRenderer();
    }

    if (this.provider === "ffmpeg") {
      const isAvailable = await checkFfmpegAvailability();

      if (!isAvailable) {
        throw new Error("FFmpeg renderer selected but ffmpeg is not available");
      }

      return new FFmpegRenderer();
    }

    const exhaustiveCheck: never = this.provider;
    throw new Error(`Unsupported renderer provider: ${exhaustiveCheck}`);
  }
}
