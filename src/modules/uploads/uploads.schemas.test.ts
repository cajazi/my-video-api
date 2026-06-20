import { describe, expect, it } from "vitest";
import { completeUploadSchema, signUploadSchema } from "./uploads.schemas";

describe("upload schemas", () => {
  it("accepts a valid sign request", () => {
    expect(
      signUploadSchema.safeParse({
        fileName: "clip.mp4",
        mimeType: "video/mp4",
      }).success,
    ).toBe(true);
  });

  it("accepts a valid complete request", () => {
    expect(
      completeUploadSchema.safeParse({
        storageKey: "uploads/user-id/clip.mp4",
        originalFileName: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 10485760,
        durationSeconds: 120,
      }).success,
    ).toBe(true);
  });

  it("rejects unsafe sizes", () => {
    expect(
      completeUploadSchema.safeParse({
        storageKey: "uploads/user-id/clip.mp4",
        originalFileName: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
  });
});
