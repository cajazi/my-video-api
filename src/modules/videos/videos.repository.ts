import type { PrismaClient } from "@prisma/client";
import { VideoStatus } from "@prisma/client";

const videoSelect = {
  id: true,
  ownerId: true,
  originalFileName: true,
  storageKey: true,
  mimeType: true,
  sizeBytes: true,
  durationSeconds: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

export class VideosRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: {
    ownerId: string;
    originalFileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
    durationSeconds?: number;
  }) {
    return this.prisma.video.create({
      data: {
        ...input,
        status: VideoStatus.UPLOADED,
      },
      select: videoSelect,
    });
  }

  findManyByOwner(ownerId: string) {
    return this.prisma.video.findMany({
      where: {
        ownerId,
        status: {
          not: VideoStatus.DELETED,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: videoSelect,
    });
  }

  findByIdForOwner(id: string, ownerId: string) {
    return this.prisma.video.findFirst({
      where: {
        id,
        ownerId,
        status: {
          not: VideoStatus.DELETED,
        },
      },
      select: videoSelect,
    });
  }

  softDelete(id: string, ownerId: string) {
    return this.prisma.video.updateMany({
      where: {
        id,
        ownerId,
        status: {
          not: VideoStatus.DELETED,
        },
      },
      data: {
        status: VideoStatus.DELETED,
      },
    });
  }
}
