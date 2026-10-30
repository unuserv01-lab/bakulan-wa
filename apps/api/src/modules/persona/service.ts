import { prisma } from "@bakulan/db";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

export interface PersonaInput {
  name: string;
  systemPrompt: string;
  aiProvider?: "deepseek" | "qwen";
}

export const listPersonas = (tenantId: string) =>
  prisma.persona.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });

export async function createPersona(tenantId: string, input: PersonaInput) {
  // Persona pertama otomatis aktif.
  const existing = await prisma.persona.count({ where: { tenantId } });
  return prisma.persona.create({
    data: {
      tenantId,
      name: input.name,
      systemPrompt: input.systemPrompt,
      aiProvider: input.aiProvider ?? "deepseek",
      isActive: existing === 0,
    },
  });
}

async function findOwned(tenantId: string, personaId: string) {
  const persona = await prisma.persona.findFirst({ where: { id: personaId, tenantId } });
  if (!persona) throw new NotFoundError("Persona tidak ditemukan");
  return persona;
}

export async function updatePersona(tenantId: string, personaId: string, data: Partial<PersonaInput>) {
  await findOwned(tenantId, personaId);
  return prisma.persona.update({ where: { id: personaId }, data });
}

// Hanya satu persona aktif per tenant: mengaktifkan satu menonaktifkan yang lain dalam satu transaksi,
// jadi ai-worker tidak pernah harus memilih di antara dua persona "aktif".
export async function activatePersona(tenantId: string, personaId: string) {
  await findOwned(tenantId, personaId);
  return prisma.$transaction(async (tx) => {
    await tx.persona.updateMany({ where: { tenantId }, data: { isActive: false } });
    return tx.persona.update({ where: { id: personaId }, data: { isActive: true } });
  });
}

export async function deletePersona(tenantId: string, personaId: string) {
  const persona = await findOwned(tenantId, personaId);
  if (persona.isActive) throw new ConflictError("Persona aktif tidak bisa dihapus — aktifkan persona lain dulu");
  await prisma.persona.delete({ where: { id: personaId } });
}
