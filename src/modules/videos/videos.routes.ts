import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/auth.middleware";
import { VideosController } from "./videos.controller";
import { VideosRepository } from "./videos.repository";
import { VideosService } from "./videos.service";

export async function videosRoutes(app: FastifyInstance) {
  const repository = new VideosRepository(app.prisma);
  const service = new VideosService(repository);
  const controller = new VideosController(service);

  app.addHook("preHandler", requireAuth);

  app.post("/", controller.create);
  app.get("/", controller.list);
  app.get("/:id", controller.getById);
  app.delete("/:id", controller.deleteById);
}
