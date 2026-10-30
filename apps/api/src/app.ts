import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "@bakulan/config";
import { AppError } from "./lib/errors.js";
import dbPlugin from "./plugins/db.js";
import redisPlugin from "./plugins/redis.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./modules/auth/routes.js";
import tenantRoutes from "./modules/tenants/routes.js";
import personaRoutes from "./modules/persona/routes.js";
import waRoutes from "./modules/wa/routes.js";
import billingRoutes from "./modules/billing/routes.js";
import webhookRoutes from "./modules/webhooks/routes.js";
import messageRoutes from "./modules/messages/routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    // Di belakang Caddy: ambil IP asli klien dari X-Forwarded-For (dipakai rate limit).
    trustProxy: true,
    bodyLimit: 100_000,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });

  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(authPlugin);

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Data yang dikirim tidak valid",
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    // Error 4xx bawaan Fastify/plugin (JSON rusak, rate limit 429, dll).
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "REQUEST_ERROR", message: (error as Error).message });
    }
    req.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "INTERNAL", message: "Terjadi kesalahan di server" });
  });

  app.get("/health", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await app.db.$queryRaw`SELECT 1`;
      await app.redis.ping();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });

  await app.register(authRoutes);
  await app.register(tenantRoutes);
  await app.register(personaRoutes);
  await app.register(waRoutes);
  await app.register(billingRoutes);
  await app.register(webhookRoutes);
  await app.register(messageRoutes);

  return app;
}
