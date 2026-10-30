import { createServer } from "node:http";
import { Redis } from "ioredis";
import { z } from "zod";
import { env } from "@bakulan/config";
import { prisma } from "@bakulan/db";
import { WA_CHANNELS } from "@bakulan/shared-types";
import { logger } from "./logger.js";
import { incomingQueue, redis } from "./queue/queues.js";
import { startOutgoingWorker } from "./queue/outgoing.js";
import { SessionManager } from "./sessions/manager.js";

const manager = new SessionManager();

// ---- perintah dari API (pub/sub) ----
const requestSchema = z.object({ tenantId: z.string(), waSessionId: z.string() });
const sub = new Redis(env.REDIS_URL);
await sub.subscribe(WA_CHANNELS.CONNECT, WA_CHANNELS.DISCONNECT);
sub.on("message", (channel: string, raw: string) => {
  let req;
  try {
    req = requestSchema.parse(JSON.parse(raw));
  } catch {
    logger.warn({ channel }, "pesan pub/sub tidak valid");
    return;
  }
  const task =
    channel === WA_CHANNELS.CONNECT
      ? manager.start(req.waSessionId)
      : manager.stop(req.waSessionId, { logout: true });
  task.catch((err) => logger.error({ err, channel, waSessionId: req.waSessionId }, "gagal menjalankan perintah"));
});

// ---- boot ----
await manager.startAll();
const outgoingWorker = startOutgoingWorker(manager);

const reconcileTimer = setInterval(() => manager.reconcile().catch((err) => logger.error({ err }, "reconcile gagal")), 30_000);
const downTimer = setInterval(() => manager.checkDown().catch((err) => logger.error({ err }, "checkDown gagal")), 5 * 60_000);

// ---- health endpoint ----
const health = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", sessions: manager.stats() }));
    return;
  }
  res.writeHead(404).end();
});
health.listen(env.WA_WORKER_HEALTH_PORT, "0.0.0.0");
logger.info({ port: env.WA_WORKER_HEALTH_PORT }, "wa-worker siap");

// ---- shutdown rapi: simpan auth state semua sesi, tutup socket tanpa logout ----
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "wa-worker berhenti");
  clearInterval(reconcileTimer);
  clearInterval(downTimer);
  health.close();
  await outgoingWorker.close();
  await manager.shutdown();
  await incomingQueue.close();
  await sub.quit();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void shutdown(signal));
