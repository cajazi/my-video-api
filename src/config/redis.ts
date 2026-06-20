import Redis from "ioredis";
import { env } from "./env";

export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD === "" ? undefined : env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});
