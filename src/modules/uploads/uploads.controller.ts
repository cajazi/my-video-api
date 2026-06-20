import type { FastifyReply, FastifyRequest } from "fastify";
import { handleHttpError } from "../../utils/http-error";
import { completeUploadSchema, downloadParamsSchema, signUploadSchema } from "./uploads.schemas";
import type { UploadsService } from "./uploads.service";

const INVALID_BODY_RESPONSE = { message: "Invalid request body" };
const INVALID_PARAMS_RESPONSE = { message: "Invalid route parameters" };
const UNAUTHORIZED_RESPONSE = { message: "Unauthorized" };

export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  sign = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const body = signUploadSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    try {
      return await this.service.signUpload(request.authUser.id, body.data);
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };

  complete = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const body = completeUploadSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(INVALID_BODY_RESPONSE);
    }

    try {
      const video = await this.service.completeUpload(request.authUser.id, body.data);
      return reply.status(201).send(video);
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };

  download = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.status(401).send(UNAUTHORIZED_RESPONSE);
    }

    const params = downloadParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send(INVALID_PARAMS_RESPONSE);
    }

    try {
      return await this.service.createDownloadUrl(request.authUser.id, params.data.videoId);
    } catch (error) {
      return handleHttpError(reply, error);
    }
  };
}
