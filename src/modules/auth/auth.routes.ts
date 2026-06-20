import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthError } from "./auth.errors";
import { requireAuth } from "./auth.middleware";
import { AuthRepository } from "./auth.repository";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "./auth.schemas";
import { AuthService } from "./auth.service";

const INVALID_BODY_RESPONSE = { message: "Invalid request body" };

function authService(app: FastifyInstance) {
  return new AuthService(app.prisma, new AuthRepository(app.prisma), app.jwt);
}

function handleAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({ message: error.message });
  }

  throw error;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (request, reply) => {
    const body = registerSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    try {
      const session = await authService(app).register(body.data);
      return reply.status(201).send(session);
    } catch (error) {
      return handleAuthError(reply, error);
    }
  });

  app.post("/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    try {
      return await authService(app).login(body.data);
    } catch (error) {
      return handleAuthError(reply, error);
    }
  });

  app.post("/refresh", async (request, reply) => {
    const body = refreshSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    try {
      return await authService(app).refresh(body.data.refreshToken);
    } catch (error) {
      return handleAuthError(reply, error);
    }
  });

  app.post("/logout", async (request, reply) => {
    const body = logoutSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    await authService(app).logout(body.data.refreshToken);
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.authUser) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    try {
      return await authService(app).getMe(request.authUser.id);
    } catch (error) {
      return handleAuthError(reply, error);
    }
  });
}
