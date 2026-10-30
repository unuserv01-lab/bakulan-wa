import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { redisKeys } from "@bakulan/shared-types";
import { getOwnedTenantOrThrow } from "../../lib/tenant.js";

const listQuery = z.object({
  contact: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

export default async function messageRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  // Daftar percakapan (satu baris per kontak), terbaru di atas.
  app.get("/conversations", auth, async (req) => {
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const groups = await app.db.message.groupBy({
      by: ["contactJid"],
      where: { tenantId: tenant.id },
      _max: { createdAt: true },
      _count: { _all: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: 50,
    });
    return groups.map((g) => ({
      contactJid: g.contactJid,
      lastMessageAt: g._max.createdAt,
      messageCount: g._count._all,
    }));
  });

  app.get("/messages", auth, async (req) => {
    const q = listQuery.parse(req.query);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const messages = await app.db.message.findMany({
      where: {
        tenantId: tenant.id,
        ...(q.contact ? { contactJid: q.contact } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limit,
      select: {
        id: true,
        contactJid: true,
        direction: true,
        content: true,
        promptTokens: true,
        completionTokens: true,
        createdAt: true,
      },
    });
    return { messages };
  });

  // Setelah pemilik membalas manual dari HP, AI diam otomatis. Endpoint ini mengaktifkan AI lagi
  // untuk satu kontak tanpa menunggu masa tunggu habis.
  app.post("/conversations/resume-ai", auth, async (req, reply) => {
    const { contactJid } = z.object({ contactJid: z.string().min(1).max(100) }).parse(req.body);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const session = await app.db.waSession.findUnique({ where: { tenantId: tenant.id }, select: { id: true } });
    if (session) await app.redis.del(redisKeys.handover(session.id, contactJid));
    reply.code(204).send();
  });
}
