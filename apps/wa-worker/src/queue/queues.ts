import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@bakulan/config";
import { QUEUE_NAMES, type IncomingMessageJob } from "@bakulan/shared-types";

// maxRetriesPerRequest: null wajib untuk BullMQ.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const incomingQueue = new Queue<IncomingMessageJob>(QUEUE_NAMES.INCOMING_MESSAGE, { connection: redis });

export const INCOMING_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 2000 },
  removeOnFail: { age: 86_400 },
};
