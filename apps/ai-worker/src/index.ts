import { createServer } from "node:http";
import { Worker } from "bullmq";
import { env } from "@bakulan/config";
import { prisma } from "@bakulan/db";
import { QUEUE_NAMES, type IncomingMessageJob } from "@bakulan/shared-types";
import { logger } from "./logger.js";
import { processIncoming, sendFallbackOnce } from "./processor.js";
import { outgoingQueue, redis } from "./queue/queues.js";

const worker = new Worker<IncomingMessageJob>(
  QUEUE_NAMES.INCOMING_MESSAGE,
  async (job) => {
    const log = logger.child({ jobId: job.id, tenantId: job.data.tenantId });
    try {
      const result = await processIncoming(job.data, log);
      log.info({ result }, "job selesai");
      return result;
    } catch (err) {
      // Percobaan terakhir gagal: jangan biarkan pelanggan tanpa respons sama sekali.
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= attempts) {
        await sendFallbackOnce(job.data).catch((e) => log.error({ err: e }, "gagal mengirim fallback"));
      }
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 5,
    // Pengaman biaya & rate limit provider: maksimum 20 job/detik di seluruh worker ini.
    limiter: { max: 20, duration: 1000 },
  },
);

worker.on("failed", (job, err) => {
  logger.warn({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, "job gagal");
});
worker.on("error", (err) => logger.error({ err }, "worker error"));

const health = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404).end();
});
health.listen(env.AI_WORKER_HEALTH_PORT, "0.0.0.0");
logger.info({ port: env.AI_WORKER_HEALTH_PORT }, "ai-worker siap");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "ai-worker berhenti");
  health.close();
  await worker.close(); // tunggu job yang sedang berjalan selesai
  await outgoingQueue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void shutdown(signal));
