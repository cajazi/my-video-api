import { describe, expect, it } from "vitest";
import { addDays, hashRefreshToken, toPublicUser } from "./auth.utils";

describe("auth utils", () => {
  it("hashes refresh tokens deterministically without storing the raw token", () => {
    const token = "refresh-token-value";
    const hash = hashRefreshToken(token);

    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
  });

  it("omits passwordHash from public users", () => {
    const user = {
      id: "9ea60b73-c202-47f3-a67f-564833df8562",
      email: "user@example.com",
      passwordHash: "secret",
      name: "User",
      role: "USER" as const,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    expect(toPublicUser(user)).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  });

  it("adds days in UTC", () => {
    expect(addDays(new Date("2026-01-01T00:00:00.000Z"), 30).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
