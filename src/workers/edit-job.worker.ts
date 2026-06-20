import { EditJobStatus } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { env } from "../config/env";
import { RenderingFactory } from "../modules/rendering/rendering.factory";
import { RenderingService } from "../modules/rendering/rendering.service";
import type { RenderResult } from "../modules/rendering/rendering.types";
import {
  EDIT_JOB_PROCESS_NAME,
  EDIT_JOBS_QUEUE_NAME,
  editJobQueuePayloadSchema,
  type EditJobQueuePayload,
} from "../queues/queue.constants";
import { EDIT_JOB_WORKER_CONCURRENCY } from "./worker.constants";

type EditJobUpdate = {
  where: {
    id: string;
  };
  data: {
    status: EditJobStatus;
    startedAt?: Date | null;
    completedAt?: Date | null;
    errorMessage?: string | null;
    outputStorageKey?: string | null;
  };
};

type EditJobPersistence = {
  editJob: {
    update(input: EditJobUpdate): Promise<unknown>;
  };
};

type StructuredLogger = {
  info(input: Record<string, unknown>): void;
  error(input: Record<string, unknown>): void;
};

type EditJobRenderingService = {
  renderEditJob(editJobId: string): Promise<RenderResult>;
};

type ProcessEditJobDependencies = {
  prisma: EditJobPersistence;
  renderingService: EditJobRenderingService;
  logger: StructuredLogger;
  now?: () => Date;
};

function buildPrismaConnectionString(databaseUrl: string) {
  const url = new URL(databaseUrl);

  if (url.searchParams.get("sslmode") === "require" && !url.searchParams.has("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown worker error";
}

function createConsoleLogger(): StructuredLogger {
  return {
    info(input) {
      console.info(JSON.stringify(input));
    },
    error(input) {
      console.error(JSON.stringify(input));
    },
  };
}

export async function processEditJob(job: Job<EditJobQueuePayload>, dependencies: ProcessEditJobDependencies) {
  const payload = editJobQueuePayloadSchema.parse(job.data);
  const now = dependencies.now ?? (() => new Date());
  const logContext = {
    queueName: EDIT_JOBS_QUEUE_NAME,
    jobName: EDIT_JOB_PROCESS_NAME,
    bullJobId: job.id,
    editJobId: payload.editJobId,
    userId: payload.userId,
    videoId: payload.videoId,
  };

  dependencies.logger.info({
    event: "edit_job.job_started",
    ...logContext,
  });

  await dependencies.prisma.editJob.update({
    where: {
      id: payload.editJobId,
    },
    data: {
      status: EditJobStatus.PROCESSING,
      startedAt: now(),
      completedAt: null,
      errorMessage: null,
    },
  });

  try {
    const renderResult = await dependencies.renderingService.renderEditJob(payload.editJobId);

    await dependencies.prisma.editJob.update({
      where: {
        id: payload.editJobId,
      },
      data: {
        status: EditJobStatus.COMPLETED,
        outputStorageKey: renderResult.outputStorageKey,
        completedAt: now(),
        errorMessage: null,
      },
    });

    dependencies.logger.info({
      event: "edit_job.job_completed",
      ...logContext,
    });
  } catch (error) {
    await dependencies.prisma.editJob.update({
      where: {
        id: payload.editJobId,
      },
      data: {
        status: EditJobStatus.FAILED,
        completedAt: now(),
        errorMessage: serializeError(error),
      },
    });

    dependencies.logger.error({
      event: "edit_job.job_failed",
      errorMessage: serializeError(error),
      ...logContext,
    });

    throw error;
  }
}

export async function startEditJobWorker() {
  const { redisConnection } = require("../config/redis") as typeof import("../config/redis");
  const adapter = new PrismaPg({
    connectionString: buildPrismaConnectionString(env.DATABASE_URL),
  });
  const prisma = new PrismaClient({
    adapter,
  });
  const logger = createConsoleLogger();
  const renderingService = await new RenderingFactory(prisma, env.RENDERER_PROVIDER).createRenderingService();
  const worker = new Worker<EditJobQueuePayload, void, typeof EDIT_JOB_PROCESS_NAME>(
    EDIT_JOBS_QUEUE_NAME,
    async (job) => {
      await processEditJob(job, {
        prisma,
        renderingService,
        logger,
      });
    },
    {
      connection: redisConnection as unknown as ConnectionOptions,
      concurrency: EDIT_JOB_WORKER_CONCURRENCY,
    },
  );

  worker.on("failed", (job, error) => {
    logger.error({
      event: "edit_job.worker_job_failed",
      bullJobId: job?.id,
      errorMessage: serializeError(error),
    });
  });

  logger.info({
    event: "edit_job.worker_started",
    queueName: EDIT_JOBS_QUEUE_NAME,
  });

  let isShuttingDown = false;

  async function shutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info({
      event: "edit_job.worker_shutdown_started",
      signal,
    });

    await worker.close();
    await redisConnection.quit();
    await prisma.$disconnect();

    logger.info({
      event: "edit_job.worker_shutdown_completed",
      signal,
    });
  }

  process.once("SIGINT", (signal) => {
    void shutdown(signal).then(() => process.exit(0));
  });
  process.once("SIGTERM", (signal) => {
    void shutdown(signal).then(() => process.exit(0));
  });

  return {
    worker,
    prisma,
    redisConnection,
    shutdown,
  };
}

if (require.main === module) {
  startEditJobWorker().catch((error) => {
    console.error(
      JSON.stringify({
        event: "edit_job.worker_start_failed",
        errorMessage: serializeError(error),
      }),
    );
    process.exit(1);
  });
}
