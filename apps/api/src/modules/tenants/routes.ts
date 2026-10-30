import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getOwnedTenantOrThrow } from "../../lib/tenant.js";

const updateSchema = z.object({ businessName: z.string().trim().min(2).max(100) });

export default async function tenantRoutes(app: FastifyInstance) {
  app.get("/tenants/me", { onRequest: [app.authenticate] }, async (req) => {
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const wallet = await app.db.walletBalance.findUnique({ where: { tenantId: tenant.id } });
    return {
      id: tenant.id,
      businessName: tenant.businessName,
      status: tenant.status,
      walletBalance: (wallet?.balance ?? 0).toString(),
      createdAt: tenant.createdAt,
    };
  });

  app.patch("/tenants/me", { onRequest: [app.authenticate] }, async (req) => {
    const body = updateSchema.parse(req.body);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    const updated = await app.db.tenant.update({
      where: { id: tenant.id },
      data: { businessName: body.businessName },
    });
    return { id: updated.id, businessName: updated.businessName };
  });
}
