import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "@bakulan/config";
import { UnauthorizedError } from "../../lib/errors.js";
import { verifyMidtransSignature } from "../billing/signature.js";
import { processMidtransNotification } from "../billing/service.js";

const notificationSchema = z
  .object({
    order_id: z.string(),
    status_code: z.string(),
    gross_amount: z.string(),
    signature_key: z.string(),
    transaction_status: z.string(),
    fraud_status: z.string().optional(),
  })
  .passthrough();

export default async function webhookRoutes(app: FastifyInstance) {
  // Tanpa auth JWT (dipanggil Midtrans). Pengamanan: signature SHA512 + konfirmasi ke Status API.
  // Balas 2xx untuk notifikasi yang valid tapi tidak relevan (supaya Midtrans tidak retry terus);
  // balas 5xx kalau konfirmasi gagal sementara (supaya Midtrans retry).
  app.post("/webhooks/midtrans", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = notificationSchema.parse(req.body);

    if (!verifyMidtransSignature(body, env.MIDTRANS_SERVER_KEY)) {
      req.log.warn({ orderId: body.order_id }, "midtrans webhook: signature tidak valid");
      throw new UnauthorizedError("Invalid signature");
    }

    const result = await processMidtransNotification(body);
    req.log.info({ orderId: body.order_id, ...result }, "midtrans webhook processed");
    reply.code(200).send({ ok: true });
  });
}
