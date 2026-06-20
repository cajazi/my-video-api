import { describe, expect, it } from "vitest";
import { createEditJobSchema } from "./edit-jobs.schemas";

describe("createEditJobSchema", () => {
  it("accepts the first edit job payload shape", () => {
    const result = createEditJobSchema.safeParse({
      videoId: "0f6979d0-4db1-49f7-b99f-6f5b6f706286",
      inputConfig: {
        trim: {
          start: 5,
          end: 60,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid video ids", () => {
    const result = createEditJobSchema.safeParse({
      videoId: "not-a-uuid",
      inputConfig: {},
    });

    expect(result.success).toBe(false);
  });
});
