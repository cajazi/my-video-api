import type { UserRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  type: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  tokenId: string;
  type: "refresh";
};

export type JwtService = {
  signAccessToken(payload: Omit<AccessTokenPayload, "type">): string;
  signRefreshToken(payload: Omit<RefreshTokenPayload, "type">): string;
  verifyAccessToken(token: string): AccessTokenPayload;
  verifyRefreshToken(token: string): RefreshTokenPayload;
};

function assertAccessPayload(payload: string | jwt.JwtPayload): asserts payload is AccessTokenPayload {
  if (
    typeof payload === "string" ||
    payload.type !== "access" ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    (payload.role !== "USER" && payload.role !== "ADMIN")
  ) {
    throw new Error("Invalid access token");
  }
}

function assertRefreshPayload(payload: string | jwt.JwtPayload): asserts payload is RefreshTokenPayload {
  if (
    typeof payload === "string" ||
    payload.type !== "refresh" ||
    typeof payload.sub !== "string" ||
    typeof payload.tokenId !== "string"
  ) {
    throw new Error("Invalid refresh token");
  }
}

const jwtService: JwtService = {
  signAccessToken(payload) {
    return jwt.sign({ ...payload, type: "access" }, env.JWT_ACCESS_SECRET, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  },

  signRefreshToken(payload) {
    return jwt.sign({ ...payload, type: "refresh" }, env.JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });
  },

  verifyAccessToken(token) {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    assertAccessPayload(payload);
    return payload;
  },

  verifyRefreshToken(token) {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
    assertRefreshPayload(payload);
    return payload;
  },
};

declare module "fastify" {
  interface FastifyInstance {
    jwt: JwtService;
  }
}

async function jwtPlugin(app: FastifyInstance) {
  app.decorate("jwt", jwtService);
}

export default fp(jwtPlugin, {
  name: "jwt",
});
