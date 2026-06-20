import type { FastifyReply, FastifyRequest } from "fastify";
import { handleHttpError } from "../../utils/http-error";
import { createEditJobSchema, editJobIdParamsSchema } from "./edit-jobs.schemas";
import type { EditJobsService } from "./edit-jobs.service";

const INVALID_BODY_RESPONSE = { message: "Invalid request body" };
const INVALID_PARAMS_RESPONSE = { message: "Invalid route parameters" };
const UNAUTHORIZED_RESPONSE = { message: "Unauthorized" };

export class EditJobsController {
  constructor(private readonly service: EditJobsService) {}

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const body = createEditJobSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    try {
      const editJob = await this.service.createEditJob(request.authUser.id, body.data);
      return reply.status(201).send(editJob);
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const params = editJobIdParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send(INVALID_PARAMS_RESPONSE);
    }

    try {
      return await this.service.getEditJob(request.authUser.id, params.data.id);
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };
}
