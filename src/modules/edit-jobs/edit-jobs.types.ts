import type { EditJob, EditJobStatus, Prisma } from "@prisma/client";

export type EditJobRecord = Pick<
  EditJob,
  | "id"
  | "userId"
  | "videoId"
  | "status"
  | "inputConfig"
  | "outputStorageKey"
  | "errorMessage"
  | "startedAt"
  | "completedAt"
  | "createdAt"
  | "updatedAt"
>;

export type EditJobResponse = {
  id: string;
  userId: string;
  videoId: string;
  status: EditJobStatus;
  inputConfig: Prisma.JsonValue;
  outputStorageKey: string | null;
  outputDownloadUrl?: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
