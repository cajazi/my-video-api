import { VideoStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { toVideoResponse } from "./videos.presenter";

describe("toVideoResponse", () => {
  it("serializes BigInt sizeBytes as a JSON-safe number", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    expect(
      toVideoResponse({
        id: "0f6979d0-4db1-49f7-b99f-6f5b6f706286",
        ownerId: "23b2ca96-5488-42f5-a1e5-4188fcfd49bf",
        originalFileName: "clip.mp4",
        storageKey: "uploads/user-id/clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 10485760n,
        durationSeconds: 120,
        status: VideoStatus.UPLOADED,
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({
      sizeBytes: 10485760,
      status: VideoStatus.UPLOADED,
    });
  });
});
