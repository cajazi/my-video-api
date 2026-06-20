import type { FastifyReply, FastifyRequest } from "fastify";
import { handleHttpError } from "../../utils/http-error";
import { createVideoSchema, videoIdParamsSchema } from "./videos.schemas";
import type { VideosService } from "./videos.service";

const INVALID_BODY_RESPONSE = { message: "Invalid request body" };
const INVALID_PARAMS_RESPONSE = { message: "Invalid route parameters" };
const UNAUTHORIZED_RESPONSE = { message: "Unauthorized" };

export class VideosController {
  constructor(private readonly service: VideosService) {}

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const body = createVideoSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    try {
      const video = await this.service.createVideo(request.authUser.id, body.data);
      return reply.status(201).send(video);
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    return this.service.listVideos(request.authUser.id);
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const params = videoIdParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send(INVALID_PARAMS_RESPONSE);
    }

    try {
      return await this.service.getVideo(request.authUser.id, params.data.id);
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };

  deleteById = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const params = videoIdParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send(INVALID_PARAMS_RESPONSE);
    }

    try {
      await this.service.deleteVideo(request.authUser.id, params.data.id);
      return reply.status(204).send();
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };
}
