import type { PrismaClient } from "@prisma/client";
import { VideoStatus } from "@prisma/client";

export class UploadsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findVideoForDownload(videoId: string, ownerId: string) {
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
        storageKey: true,
      },
    });
  }
}
