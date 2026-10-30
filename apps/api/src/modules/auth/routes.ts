import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "@bakulan/config";
import { UnauthorizedError } from "../../lib/errors.js";
import { generateRefreshToken, refreshKey, registerUser, verifyCredentials } from "./service.js";

const email = z.string().trim().toLowerCase().email();

const registerSchema = z.object({
  email,
  password: z.string().min(8, "Password minimal 8 karakter").max(200),
  businessName: z.string().trim().min(2).max(100),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

const REFRESH_TTL_SECONDS = env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60;

// Pembatasan ketat untuk endpoint yang bisa di-bruteforce.
const strictLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export default async function authRoutes(app: FastifyInstance) {
  async function issueTokens(user: { id: string; email: string }) {
    const accessToken = app.jwt.sign({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    await app.redis.set(refreshKey(refreshToken), user.id, "EX", REFRESH_TTL_SECONDS);
    return { accessToken, refreshToken };
  }

  app.post("/auth/register", { config: strictLimit }, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const { user, tenant } = await registerUser(body);
    const tokens = await issueTokens(user);
    reply.code(201).send({ user: { id: user.id, email: user.email, tenantId: tenant.id }, ...tokens });
  });

  app.post("/auth/login", { config: strictLimit }, async (req) => {
    const body = loginSchema.parse(req.body);
    const user = await verifyCredentials(body.email, body.password);
    const tokens = await issueTokens(user);
    return { user: { id: user.id, email: user.email }, ...tokens };
  });

  // Rotasi: refresh token lama langsung dicabut, token baru diterbitkan.
  app.post("/auth/refresh", { config: strictLimit }, async (req) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const key = refreshKey(refreshToken);
    const userId = await app.redis.get(key);
    if (!userId) throw new UnauthorizedError("Refresh token tidak valid atau kedaluwarsa");

    const user = await app.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError("User tidak ditemukan");

    await app.redis.del(key);
    return issueTokens(user);
  });

  // Logout hanya butuh refresh token (access token bisa saja sudah kedaluwarsa).
  app.post("/auth/logout", async (req, reply) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await app.redis.del(refreshKey(refreshToken));
    reply.code(204).send();
  });
}
