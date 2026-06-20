import type { Video, VideoStatus } from "@prisma/client";

export type VideoRecord = Pick<
  Video,
  | "id"
  | "ownerId"
  | "originalFileName"
  | "storageKey"
  | "mimeType"
  | "sizeBytes"
  | "durationSeconds"
  | "status"
  | "createdAt"
  | "updatedAt"
>;

export type VideoResponse = {
  id: string;
  ownerId: string;
  originalFileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  status: VideoStatus;
  createdAt: Date;
  updatedAt: Date;
};
