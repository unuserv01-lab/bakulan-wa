import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, prisma } from "@bakulan/db";
import { PERSONA_TEMPLATES } from "@bakulan/shared-types";
import { ConflictError, UnauthorizedError } from "../../lib/errors.js";

export interface RegisterInput {
  email: string;
  password: string;
  businessName: string;
}

// argon2id: varian yang direkomendasikan OWASP (tahan GPU cracking dan side-channel).
const HASH_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function registerUser(input: RegisterInput) {
  const passwordHash = await argon2.hash(input.password, HASH_OPTS);
  const defaultTemplate = PERSONA_TEMPLATES[0]!;

  try {
    // User + tenant + saldo + persona awal dibuat atomik: setiap user langsung punya
    // persona aktif, jadi alur "scan QR -> AI membalas" jalan tanpa setup tambahan.
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: input.email, passwordHash } });
      const tenant = await tx.tenant.create({
        data: { businessName: input.businessName, ownerUserId: user.id },
      });
      await tx.walletBalance.create({ data: { tenantId: tenant.id, balance: 0 } });
      await tx.persona.create({
        data: {
          tenantId: tenant.id,
          name: defaultTemplate.name,
          systemPrompt: defaultTemplate.systemPrompt,
          isActive: true,
        },
      });
      return { user, tenant };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("Email sudah terdaftar");
    }
    throw err;
  }
}

export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new UnauthorizedError("Email atau password salah");
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) throw new UnauthorizedError("Email atau password salah");
  return user;
}

// Refresh token tidak pernah disimpan mentah — hanya sha256-nya di Redis.
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const generateRefreshToken = () => randomBytes(48).toString("base64url");
export const refreshKey = (token: string) => `auth:refresh:${hashToken(token)}`;
