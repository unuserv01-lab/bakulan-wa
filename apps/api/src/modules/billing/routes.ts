import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "@bakulan/config";
import { getBalance } from "@bakulan/db";
import { getOwnedTenantOrThrow } from "../../lib/tenant.js";
import { createTopup, getTopupStatus } from "./service.js";

const topupSchema = z.object({ amount: z.number().int().positive() });
const ledgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime().optional(),
});

export default async function billingRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  app.get("/billing/wallet", auth, async (req) => {
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const balance = await getBalance(tenant.id);
    return {
      balance: balance.toString(),
      lowBalance: balance.lt(env.MIN_BALANCE_TO_REPLY_IDR),
      topupMin: env.TOPUP_MIN_IDR,
      topupMax: env.TOPUP_MAX_IDR,
    };
  });

  app.get("/billing/ledger", auth, async (req) => {
    const q = ledgerQuery.parse(req.query);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const rows = await app.db.walletLedger.findMany({
      where: { tenantId: tenant.id, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });
    return {
      entries: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: r.amount.toString(),
        balanceAfter: r.balanceAfter.toString(),
        referenceId: r.referenceId,
        createdAt: r.createdAt,
      })),
    };
  });

  app.post("/billing/topup", { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = topupSchema.parse(req.body);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const result = await createTopup({
      tenantId: tenant.id,
      email: req.user.email,
      businessName: tenant.businessName,
      amount: body.amount,
    });
    reply.code(201).send(result);
  });

  // Dashboard memanggil ini setelah user kembali dari halaman pembayaran Midtrans.
  app.get("/billing/topup/:orderId", auth, async (req) => {
    const { orderId } = z.object({ orderId: z.string().min(1).max(60) }).parse(req.params);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    return getTopupStatus(tenant.id, orderId);
  });
}
