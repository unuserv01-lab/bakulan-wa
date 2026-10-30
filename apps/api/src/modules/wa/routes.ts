import type { FastifyInstance } from "fastify";
import { redisKeys, WA_CHANNELS, type WaSessionRequest } from "@bakulan/shared-types";
import { getOwnedTenantOrThrow } from "../../lib/tenant.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

export default async function waRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  // Memulai alur QR. Proses yang memegang socket Baileys adalah wa-worker; API hanya
  // menyiapkan baris sesi lalu memberi tahu worker lewat Redis pub/sub. Kalau pesan hilang
  // (worker sedang mati), worker menyapu sesi yang belum punya socket tiap 30 detik.
  app.post("/wa/connect", auth, async (req, reply) => {
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const existing = await app.db.waSession.findUnique({ where: { tenantId: tenant.id } });

    let session;
    if (!existing) {
      session = await app.db.waSession.create({ data: { tenantId: tenant.id, status: "pending_qr" } });
    } else if (existing.status === "connected") {
      throw new ConflictError("WhatsApp sudah terhubung");
    } else if (existing.status === "logged_out" || !existing.authStateEncrypted) {
      // Logout / belum pernah terhubung: mulai dari nol (QR baru).
      session = await app.db.waSession.update({
        where: { id: existing.id },
        data: { status: "pending_qr", authStateEncrypted: null },
      });
    } else {
      // Terputus tapi kredensial masih ada: biarkan worker menyambung ulang tanpa scan.
      session = existing;
    }

    const payload: WaSessionRequest = { tenantId: tenant.id, waSessionId: session.id };
    await app.redis.publish(WA_CHANNELS.CONNECT, JSON.stringify(payload));
    reply.code(202).send({ waSessionId: session.id, status: session.status });
  });

  // Dashboard short-poll endpoint ini (tiap ~2 detik) untuk menampilkan QR sampai status "connected".
  app.get("/wa/status", auth, async (req) => {
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const session = await app.db.waSession.findUnique({
      where: { tenantId: tenant.id },
      select: { id: true, status: true, phoneNumber: true, lastConnectedAt: true },
    });
    if (!session) return { status: "none", waSessionId: null, phoneNumber: null, qr: null, lastConnectedAt: null };

    const qr = session.status === "pending_qr" ? await app.redis.get(redisKeys.waQr(session.id)) : null;
    return {
      status: session.status,
      waSessionId: session.id,
      phoneNumber: session.phoneNumber,
      qr, // data URL PNG yang ditulis wa-worker; null kalau belum ada / sudah terhubung
      lastConnectedAt: session.lastConnectedAt,
    };
  });

  app.post("/wa/disconnect", auth, async (req, reply) => {
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const session = await app.db.waSession.findUnique({ where: { tenantId: tenant.id } });
    if (!session || session.status === "logged_out") throw new NotFoundError("Tidak ada sesi WhatsApp aktif");

    const payload: WaSessionRequest = { tenantId: tenant.id, waSessionId: session.id };
    await app.redis.publish(WA_CHANNELS.DISCONNECT, JSON.stringify(payload));
    reply.code(202).send({ ok: true });
  });
}
