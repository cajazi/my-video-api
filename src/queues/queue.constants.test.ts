import { describe, expect, it } from "vitest";
import { editJobQueuePayloadSchema } from "./queue.constants";

const validPayload = {
  editJobId: "0f6979d0-4db1-49f7-b99f-6f5b6f706286",
  userId: "c6218031-5061-4f49-a9fc-14f7f06798d0",
  videoId: "b5ff818d-5a1c-4bc0-9288-2a05377a8e58",
};

describe("editJobQueuePayloadSchema", () => {
  it("accepts the edit job queue payload shape", () => {
    expect(editJobQueuePayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects non-uuid identifiers", () => {
    const result = editJobQueuePayloadSchema.safeParse({
      ...validPayload,
      editJobId: "not-a-uuid",
    });

    expect(result.success).toBe(false);
  });
});
