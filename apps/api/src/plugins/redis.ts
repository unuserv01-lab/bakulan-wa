import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { env } from "@bakulan/config";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async (app) => {
  const redis = new Redis(env.REDIS_URL);
  redis.on("error", (err) => app.log.error({ err }, "redis error"));
  app.decorate("redis", redis);
  app.addHook("onClose", async () => {
    await redis.quit();
  });
});
