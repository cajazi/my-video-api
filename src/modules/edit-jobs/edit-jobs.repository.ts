import type { Prisma, PrismaClient } from "@prisma/client";
import { EditJobStatus, VideoStatus } from "@prisma/client";

const editJobSelect = {
  id: true,
  userId: true,
  videoId: true,
  status: true,
  inputConfig: true,
  outputStorageKey: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
};

export class EditJobsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findVideoForOwner(videoId: string, ownerId: string) {
    return this.prisma.video.findFirst({
      where: {
        id: videoId,
        ownerId,
        status: {
          not: VideoStatus.DELETED,
        },
      },
      select: {
        id: true,
      },
    });
  }

  create(input: { userId: string; videoId: string; inputConfig: Prisma.InputJsonValue }) {
    return this.prisma.editJob.create({
      data: {
        userId: input.userId,
        videoId: input.videoId,
        inputConfig: input.inputConfig,
        status: EditJobStatus.QUEUED,
      },
      select: editJobSelect,
    });
  }

  findByIdForUser(id: string, userId: string) {
    return this.prisma.editJob.findFirst({
      where: {
        id,
        userId,
      },
      select: editJobSelect,
    });
  }
}
