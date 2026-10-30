import fp from "fastify-plugin";
import { prisma } from "@bakulan/db";

declare module "fastify" {
  interface FastifyInstance {
    db: typeof prisma;
  }
}

export default fp(async (app) => {
  app.decorate("db", prisma);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
