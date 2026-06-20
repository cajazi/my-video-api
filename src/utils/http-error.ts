import type { FastifyReply } from "fastify";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
  ) {
    super(message);
  }
}

export function handleHttpError(reply: FastifyReply, error: unknown) {
  if (error instanceof HttpError) {
    return reply.status(error.statusCode).send({ message: error.message });
  }

  throw error;
}
