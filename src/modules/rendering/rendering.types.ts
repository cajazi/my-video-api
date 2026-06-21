import type { Prisma } from "@prisma/client";

export type RenderInput = {
  editJobId: string;
  userId: string;
  videoId: string;
  inputConfig: Prisma.JsonValue;
  sourceStorageKey: string;
};

export type RenderResult = {
  outputStorageKey: string;
  localOutputPath: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
};
