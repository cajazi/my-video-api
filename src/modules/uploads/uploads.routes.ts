import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/auth.middleware";
import { VideosRepository } from "../videos/videos.repository";
import { UploadsController } from "./uploads.controller";
import { UploadsRepository } from "./uploads.repository";
import { UploadsService } from "./uploads.service";
import { UploadsStorage } from "./uploads.storage";

export async function uploadsRoutes(app: FastifyInstance) {
  const storage = new UploadsStorage();
  const uploadsRepository = new UploadsRepository(app.prisma);
  const videosRepository = new VideosRepository(app.prisma);
  const service = new UploadsService(storage, uploadsRepository, videosRepository);
  const controller = new UploadsController(service);

  app.addHook("preHandler", requireAuth);

  app.post("/sign", controller.sign);
  app.post("/complete", controller.complete);
  app.get("/download/:videoId", controller.download);
}
