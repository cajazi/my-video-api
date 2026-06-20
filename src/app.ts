import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { authRoutes } from "./modules/auth/auth.routes";
import jwtPlugin from "./plugins/jwt";
import prismaPlugin from "./plugins/prisma";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(jwtPlugin);
  app.register(prismaPlugin);
  app.register(cors);
  app.register(helmet);
  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/db", async (request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;

      return {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.error(error);

      return reply.status(503).send({
        status: "error",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.register(authRoutes, {
    prefix: "/api/v1/auth",
  });

  return app;
}
