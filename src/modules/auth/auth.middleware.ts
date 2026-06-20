import type { FastifyReply, FastifyRequest } from "fastify";
import { UNAUTHORIZED_MESSAGE } from "./auth.constants";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
};

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization;
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    return reply.status(401).send({ message: UNAUTHORIZED_MESSAGE });
  }

  try {
    const payload = request.server.jwt.verifyAccessToken(token);

    request.authUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    return reply.status(401).send({ message: UNAUTHORIZED_MESSAGE });
  }
}
