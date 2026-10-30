import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { Prisma, debitWallet, getBalance, hasLedgerEntry, prisma } from "@bakulan/db";
import { env } from "@bakulan/config";
import { redisKeys, type IncomingMessageJob } from "@bakulan/shared-types";
import { computeCostIDR } from "./billing/meter.js";
import { buildMessages } from "./memory/build.js";
import { loadHistory } from "./memory/history.js";
import { OUTGOING_JOB_OPTS, outgoingQueue, redis } from "./queue/queues.js";
import { pricingFor, route } from "./router/index.js";

// Ditampilkan ke PELANGGAN tenant saat AI tidak bisa membalas. Sengaja netral: pelanggan
// tidak perlu tahu soal saldo/biaya tenant.
export const FALLBACK_TEXT = "Terima kasih sudah menghubungi kami 🙏 Pesanmu sudah kami terima, admin akan membalas secepatnya ya.";

const FALLBACK_COOLDOWN_SECONDS = 6 * 3600;
const LOCK_TTL_MS = 90_000; // > timeout AI (25s x maks 2 provider) + penulisan DB
const LOCK_WAIT_MS = 45_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Satu percakapan diproses satu per satu, supaya balasan tidak tumpang tindih dan riwayat konsisten. */
async function withContactLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    if (await redis.set(key, token, "PX", LOCK_TTL_MS, "NX")) break;
    if (Date.now() > deadline) throw new Error("Timeout menunggu giliran percakapan");
    await sleep(400);
  }
  try {
    return await fn();
  } finally {
    // Lepas hanya jika kunci masih milik kita (bukan milik proses lain setelah TTL habis).
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }
}

export async function sendFallbackOnce(job: IncomingMessageJob): Promise<void> {
  const first = await redis.set(
    redisKeys.fallbackCooldown(job.waSessionId, job.contactJid),
    "1",
    "EX",
    FALLBACK_COOLDOWN_SECONDS,
    "NX",
  );
  if (!first) return;
  await outgoingQueue.add(
    "outgoing",
    { tenantId: job.tenantId, waSessionId: job.waSessionId, toJid: job.contactJid, content: FALLBACK_TEXT },
    { ...OUTGOING_JOB_OPTS, jobId: `fallback_${job.waSessionId}_${job.waMessageId}` },
  );
}

export type ProcessResult =
  | "replied"
  | "skipped_tenant_inactive"
  | "skipped_duplicate"
  | "skipped_handover"
  | "skipped_no_persona"
  | "skipped_empty_reply"
  | "fallback_low_balance";

export async function processIncoming(job: IncomingMessageJob, log: Logger): Promise<ProcessResult> {
  const { tenantId, waSessionId, contactJid, waMessageId, content } = job;
  // Referensi tagihan unik per pesan masuk -> penagihan idempoten walau job di-retry.
  const billingRef = `msg:${waSessionId}:${waMessageId}`;

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { status: true },
  });
  if (!tenant || tenant.status !== "active") return "skipped_tenant_inactive";

  return withContactLock(redisKeys.contactLock(waSessionId, contactJid), async () => {
    if (await hasLedgerEntry("debit", billingRef)) return "skipped_duplicate";
    if (await redis.exists(redisKeys.handover(waSessionId, contactJid))) return "skipped_handover";

    // Simpan pesan masuk (idempoten lewat unique [wa_session_id, wa_message_id]).
    try {
      await prisma.message.create({
        data: { tenantId, waSessionId, contactJid, waMessageId, direction: "in", content },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // retry: pesan sudah tersimpan
    }

    const persona = await prisma.persona.findFirst({ where: { tenantId, isActive: true } });
    if (!persona) {
      log.warn({ tenantId }, "tenant tidak punya persona aktif — pesan tidak dibalas");
      return "skipped_no_persona";
    }

    const balance = await getBalance(tenantId);
    if (balance.lt(env.MIN_BALANCE_TO_REPLY_IDR)) {
      await sendFallbackOnce(job);
      return "fallback_low_balance";
    }

    const history = await loadHistory(waSessionId, contactJid, env.MEMORY_MESSAGE_LIMIT);
    const ai = await route(persona.aiProvider, buildMessages(persona.systemPrompt, history));

    // Urutan penting untuk tahan-retry: (1) antrekan balasan dengan jobId deterministik,
    // (2) simpan pesan keluar, (3) baru tagih. Crash di antaranya -> retry tidak membuat
    // balasan ganda (jobId sama diabaikan) dan tidak menagih dua kali (ledger unik).
    const cost = computeCostIDR(ai, pricingFor(ai.provider));
    const reply = ai.text.trim();

    if (reply) {
      await outgoingQueue.add(
        "outgoing",
        { tenantId, waSessionId, toJid: contactJid, content: reply },
        { ...OUTGOING_JOB_OPTS, jobId: `reply_${waSessionId}_${waMessageId}` },
      );
      try {
        await prisma.message.create({
          data: {
            tenantId,
            waSessionId,
            contactJid,
            waMessageId: `reply:${waMessageId}`,
            direction: "out",
            content: reply,
            promptTokens: ai.promptTokens,
            completionTokens: ai.completionTokens,
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }

    // Biaya sudah keluar ke provider walau balasan kosong, jadi tetap ditagih.
    const debit = await debitWallet({
      tenantId,
      amount: cost,
      referenceId: billingRef,
      allowPartial: true,
    });
    if (debit.shortfall.gt(0)) {
      log.warn({ tenantId, shortfall: debit.shortfall.toString() }, "saldo kurang saat penagihan (pesan paralel)");
    }
    log.info(
      { tenantId, provider: ai.provider, tokens: ai.promptTokens + ai.completionTokens, cost, balanceAfter: debit.balanceAfter.toString() },
      "pesan dibalas",
    );
    return reply ? "replied" : "skipped_empty_reply";
  });
}
