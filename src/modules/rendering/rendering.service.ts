import type { Prisma, PrismaClient } from "@prisma/client";
import type { Renderer } from "./renderer.interface";
import type { RenderResult } from "./rendering.types";
import { createTrimInputFromEditSpecV1, editSpecV1Schema } from "../edit-specs/edit-spec-v1.schema";

const EDIT_JOB_NOT_FOUND_MESSAGE = "Edit job not found";
const VIDEO_NOT_FOUND_MESSAGE = "Video not found";
const OWNERSHIP_MISMATCH_MESSAGE = "Edit job and video ownership mismatch";

type RenderingPrismaClient = Pick<PrismaClient, "editJob" | "video">;

export class RenderingService {
  constructor(
    private readonly prisma: RenderingPrismaClient,
    private readonly renderer: Renderer,
  ) {}

  async renderEditJob(editJobId: string): Promise<RenderResult> {
    const editJob = await this.prisma.editJob.findUnique({
      where: {
        id: editJobId,
      },
      select: {
        id: true,
        userId: true,
        videoId: true,
        inputConfig: true,
      },
    });

    if (!editJob) {
      throw new Error(EDIT_JOB_NOT_FOUND_MESSAGE);
    }

    const video = await this.prisma.video.findUnique({
      where: {
        id: editJob.videoId,
      },
      select: {
        id: true,
        ownerId: true,
        storageKey: true,
      },
    });

    if (!video) {
      throw new Error(VIDEO_NOT_FOUND_MESSAGE);
    }

    if (editJob.userId !== video.ownerId) {
      throw new Error(OWNERSHIP_MISMATCH_MESSAGE);
    }

    const editSpec = editSpecV1Schema.parse(editJob.inputConfig);
    const rendererInputConfig = createTrimInputFromEditSpecV1(editSpec);

    return this.renderer.render({
      editJobId: editJob.id,
      userId: editJob.userId,
      videoId: editJob.videoId,
      inputConfig: rendererInputConfig as Prisma.JsonValue,
      sourceStorageKey: video.storageKey,
    });
  }
}
