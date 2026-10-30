import argon2 from "argon2";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Env harus ada sebelum modul config dimuat.
vi.hoisted(() => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgresql://x:x@localhost:5432/x",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123",
    SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    MIDTRANS_SERVER_KEY: "SB-test-key",
  });
});

// ---- tiruan Prisma + wallet ----
const fake = vi.hoisted(() => ({
  prisma: {
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    tenant: { findFirst: vi.fn() },
    midtransTransaction: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
  creditWallet: vi.fn(),
  getBalance: vi.fn(),
}));

vi.mock("@bakulan/db", async () => {
  const { Prisma } = await import("@prisma/client"); // runtime murni, tidak memuat engine
  return { Prisma, prisma: fake.prisma, creditWallet: fake.creditWallet, getBalance: fake.getBalance };
});

// ---- tiruan Redis di memori ----
vi.mock("ioredis", () => {
  class FakeRedis {
    private store = new Map<string, string>();
    on() {
      return this;
    }
    async get(k: string) {
      return this.store.get(k) ?? null;
    }
    async set(k: string, v: string, ...args: unknown[]) {
      if (args.includes("NX") && this.store.has(k)) return null;
      this.store.set(k, v);
      return "OK";
    }
    async del(k: string) {
      return this.store.delete(k) ? 1 : 0;
    }
    async exists(k: string) {
      return this.store.has(k) ? 1 : 0;
    }
    async publish() {
      return 0;
    }
    async ping() {
      return "PONG";
    }
    async quit() {
      return "OK";
    }
  }
  return { Redis: FakeRedis };
});

import { computeMidtransSignature } from "./modules/billing/signature.js";
import { buildApp } from "./app.js";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let passwordHash: string;

const json = { "content-type": "application/json" };
const SERVER_KEY = "SB-test-key";

function webhookBody(over: Record<string, string> = {}) {
  const base = { order_id: "BWA-t1", status_code: "200", gross_amount: "50000.00", transaction_status: "settlement" };
  const body = { ...base, ...over };
  return {
    ...body,
    signature_key: computeMidtransSignature(body.order_id, body.status_code, body.gross_amount, SERVER_KEY),
  };
}

const stubStatusApi = (status: Record<string, string>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(status), { status: 200 })),
  );

beforeAll(async () => {
  passwordHash = await argon2.hash("rahasia123", { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
});

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

describe("auth & validasi", () => {
  it("endpoint terlindungi menolak request tanpa token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/tenants/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("UNAUTHORIZED");
  });

  it("menolak JWT palsu", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("register dengan data tidak valid -> 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: json,
      payload: { email: "bukan-email", password: "123", businessName: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("VALIDATION_ERROR");
    expect(res.json().issues.length).toBeGreaterThanOrEqual(3);
  });

  it("JSON rusak -> 400, bukan 500", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/login", headers: json, payload: "{oops" });
    expect(res.statusCode).toBe(400);
  });

  it("header keamanan terpasang (helmet)", async () => {
    const res = await app.inject({ method: "GET", url: "/tenants/me" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("login ditolak dengan pesan yang sama untuk email tak dikenal dan password salah", async () => {
    fake.prisma.user.findUnique.mockResolvedValueOnce(null);
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: json,
      payload: { email: "a@b.co", password: "x" },
    });
    fake.prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "a@b.co", passwordHash });
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: json,
      payload: { email: "a@b.co", password: "salah" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message); // tidak membocorkan keberadaan akun
  });

  it("login dibatasi rate limit (maks 10/menit)", async () => {
    fake.prisma.user.findUnique.mockResolvedValue(null);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: json,
        payload: { email: "a@b.co", password: "x" },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("rotasi refresh token", () => {
  it("token lama tidak bisa dipakai lagi setelah refresh", async () => {
    fake.prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co", passwordHash });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: json,
      payload: { email: "a@b.co", password: "rahasia123" },
    });
    expect(login.statusCode).toBe(200);
    const first = login.json().refreshToken as string;

    const refreshed = await app.inject({ method: "POST", url: "/auth/refresh", headers: json, payload: { refreshToken: first } });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json().refreshToken as string;
    expect(second).not.toBe(first);
    expect(refreshed.json().accessToken).toBeTruthy();

    const replay = await app.inject({ method: "POST", url: "/auth/refresh", headers: json, payload: { refreshToken: first } });
    expect(replay.statusCode).toBe(401); // token lama sudah dicabut

    const logout = await app.inject({ method: "POST", url: "/auth/logout", headers: json, payload: { refreshToken: second } });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({ method: "POST", url: "/auth/refresh", headers: json, payload: { refreshToken: second } });
    expect(afterLogout.statusCode).toBe(401);
  });
});

describe("webhook Midtrans (jalur uang)", () => {
  it("signature palsu -> 401, tanpa menyentuh DB atau Midtrans", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/midtrans",
      headers: json,
      payload: { ...webhookBody(), signature_key: "deadbeef" },
    });
    expect(res.statusCode).toBe(401);
    expect(fake.prisma.midtransTransaction.findUnique).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.creditWallet).not.toHaveBeenCalled();
  });

  it("body tidak lengkap -> 400", async () => {
    const res = await app.inject({ method: "POST", url: "/webhooks/midtrans", headers: json, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("signature valid tapi order tidak dikenal -> 200, tidak ada kredit", async () => {
    fake.prisma.midtransTransaction.findUnique.mockResolvedValue(null);
    const res = await app.inject({ method: "POST", url: "/webhooks/midtrans", headers: json, payload: webhookBody() });
    expect(res.statusCode).toBe(200);
    expect(fake.creditWallet).not.toHaveBeenCalled();
  });

  it("settlement terkonfirmasi di Status API -> saldo dikredit sesuai catatan kita", async () => {
    const { Prisma } = await import("@prisma/client");
    fake.prisma.midtransTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      tenantId: "tenant-1",
      orderId: "BWA-t1",
      grossAmount: new Prisma.Decimal(50000),
    });
    fake.creditWallet.mockResolvedValue({ credited: true, balanceAfter: new Prisma.Decimal(50000) });
    stubStatusApi({ order_id: "BWA-t1", status_code: "200", gross_amount: "50000.00", transaction_status: "settlement" });

    const res = await app.inject({ method: "POST", url: "/webhooks/midtrans", headers: json, payload: webhookBody() });
    expect(res.statusCode).toBe(200);
    expect(fake.creditWallet).toHaveBeenCalledTimes(1);
    const arg = fake.creditWallet.mock.calls[0]![0];
    expect(arg).toMatchObject({ tenantId: "tenant-1", type: "topup", referenceId: "BWA-t1" });
    expect(arg.amount.toString()).toBe("50000");
  });

  it("webhook mengaku settlement tapi Status API bilang pending -> TIDAK dikredit", async () => {
    const { Prisma } = await import("@prisma/client");
    fake.prisma.midtransTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      tenantId: "tenant-1",
      orderId: "BWA-t1",
      grossAmount: new Prisma.Decimal(50000),
    });
    stubStatusApi({ order_id: "BWA-t1", status_code: "201", gross_amount: "50000.00", transaction_status: "pending" });

    const res = await app.inject({ method: "POST", url: "/webhooks/midtrans", headers: json, payload: webhookBody() });
    expect(res.statusCode).toBe(200);
    expect(fake.creditWallet).not.toHaveBeenCalled();
  });

  it("nominal di Midtrans beda dari catatan kita -> 409, tidak dikredit", async () => {
    const { Prisma } = await import("@prisma/client");
    fake.prisma.midtransTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      tenantId: "tenant-1",
      orderId: "BWA-t1",
      grossAmount: new Prisma.Decimal(10000), // kita mencatat Rp10.000
    });
    stubStatusApi({ order_id: "BWA-t1", status_code: "200", gross_amount: "50000.00", transaction_status: "settlement" });

    const res = await app.inject({ method: "POST", url: "/webhooks/midtrans", headers: json, payload: webhookBody() });
    expect(res.statusCode).toBe(409);
    expect(fake.creditWallet).not.toHaveBeenCalled();
  });

  it("gagal menghubungi Midtrans -> 5xx supaya Midtrans mengirim ulang", async () => {
    const { Prisma } = await import("@prisma/client");
    fake.prisma.midtransTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      tenantId: "tenant-1",
      orderId: "BWA-t1",
      grossAmount: new Prisma.Decimal(50000),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));

    const res = await app.inject({ method: "POST", url: "/webhooks/midtrans", headers: json, payload: webhookBody() });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(fake.creditWallet).not.toHaveBeenCalled();
  });
});
