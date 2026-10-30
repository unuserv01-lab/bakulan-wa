import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@bakulan/config";
import { QUEUE_NAMES, type OutgoingMessageJob } from "@bakulan/shared-types";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const outgoingQueue = new Queue<OutgoingMessageJob>(QUEUE_NAMES.OUTGOING_MESSAGE, { connection: redis });

export const OUTGOING_JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 3000 },
  removeOnComplete: { age: 3600, count: 2000 },
  removeOnFail: { age: 86_400 },
};
