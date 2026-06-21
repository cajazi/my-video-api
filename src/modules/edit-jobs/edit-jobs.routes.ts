import type { FastifyInstance } from "fastify";
import { enqueueEditJob } from "../../queues/edit-jobs.queue";
import { requireAuth } from "../auth/auth.middleware";
import { RenderedOutputStorage } from "../storage/rendered-output.storage";
import { EditJobsController } from "./edit-jobs.controller";
import { EditJobsRepository } from "./edit-jobs.repository";
import { EditJobsService } from "./edit-jobs.service";

export async function editJobsRoutes(app: FastifyInstance) {
  const repository = new EditJobsRepository(app.prisma);
  const renderedOutputStorage = new RenderedOutputStorage();
  const service = new EditJobsService(repository, enqueueEditJob, renderedOutputStorage);
  const controller = new EditJobsController(service);

  app.addHook("preHandler", requireAuth);

  app.post("/", controller.create);
  app.get("/:id", controller.getById);
}
