import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "@bakulan/config";
import { UnauthorizedError } from "../lib/errors.js";

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthTokenPayload;
    user: AuthTokenPayload;
  }
}

// Access token: JWT pendek, diverifikasi tiap request.
// Refresh token: string acak opaque, disimpan sebagai sha256 di Redis (lihat modul auth),
// sehingga bisa dicabut dan dirotasi — bukan JWT.
export default fp(async (app) => {
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL },
  });

  app.decorate("authenticate", async (req: FastifyRequest, _reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError("Access token tidak valid atau kedaluwarsa");
    }
  });
});
