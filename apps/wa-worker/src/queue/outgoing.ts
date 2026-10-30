import { Worker } from "bullmq";
import { QUEUE_NAMES, type OutgoingMessageJob } from "@bakulan/shared-types";
import { logger } from "../logger.js";
import type { SessionManager } from "../sessions/manager.js";
import { redis } from "./queues.js";

// Retry/backoff diatur oleh pembuat job (ai-worker). Di sini cukup melempar error kalau gagal kirim.
export function startOutgoingWorker(manager: SessionManager) {
  const worker = new Worker<OutgoingMessageJob>(
    QUEUE_NAMES.OUTGOING_MESSAGE,
    async (job) => {
      await manager.sendText(job.data.waSessionId, job.data.toJid, job.data.content);
    },
    { connection: redis, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    logger.warn(
      { jobId: job?.id, attempt: job?.attemptsMade, waSessionId: job?.data.waSessionId, err: err.message },
      "kirim pesan gagal",
    );
  });
  worker.on("error", (err) => logger.error({ err }, "outgoing worker error"));
  return worker;
}
