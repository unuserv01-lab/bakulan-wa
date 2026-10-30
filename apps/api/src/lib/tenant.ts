import type { FastifyInstance } from "fastify";
import { NotFoundError } from "./errors.js";

// Semua modul mencari "tenant milik pemanggil" lewat helper ini, supaya aturan
// tenant-scoping (saat ini: satu tenant per user) ada di satu tempat.
export async function getOwnedTenantOrThrow(app: FastifyInstance, userId: string) {
  const tenant = await app.db.tenant.findFirst({ where: { ownerUserId: userId, deletedAt: null } });
  if (!tenant) throw new NotFoundError("Tenant tidak ditemukan untuk user ini");
  return tenant;
}
