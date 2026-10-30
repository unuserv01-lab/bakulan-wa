import { Prisma, creditWallet, prisma } from "@bakulan/db";
import { env } from "@bakulan/config";
import { AppError, NotFoundError } from "../../lib/errors.js";
import { createSnapTransaction, fetchTransactionStatus } from "./midtrans.js";

const KNOWN_STATUSES = ["pending", "settlement", "capture", "deny", "cancel", "expire", "failure"] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];
const isKnownStatus = (s: string): s is KnownStatus => (KNOWN_STATUSES as readonly string[]).includes(s);

export async function createTopup(params: {
  tenantId: string;
  email: string;
  businessName: string;
  amount: number;
}) {
  if (params.amount < env.TOPUP_MIN_IDR || params.amount > env.TOPUP_MAX_IDR) {
    throw new AppError(
      `Nominal top up harus antara Rp${env.TOPUP_MIN_IDR.toLocaleString("id-ID")} dan Rp${env.TOPUP_MAX_IDR.toLocaleString("id-ID")}`,
      400,
      "INVALID_AMOUNT",
    );
  }

  // order_id Midtrans maksimal 50 karakter.
  const orderId = `BWA-${params.tenantId.replaceAll("-", "").slice(0, 12)}-${Date.now().toString(36)}`;
  const snap = await createSnapTransaction({
    orderId,
    grossAmount: params.amount,
    email: params.email,
    businessName: params.businessName,
  });

  await prisma.midtransTransaction.create({
    data: { tenantId: params.tenantId, orderId, grossAmount: params.amount, status: "pending" },
  });
  return { orderId, snapToken: snap.token, redirectUrl: snap.redirect_url };
}

export interface MidtransNotificationBody {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  transaction_status: string;
  fraud_status?: string;
}

/**
 * Dipanggil webhook SETELAH signature valid. Status akhir diambil dari Status API Midtrans
 * (bukan dari body webhook), lalu saldo dikredit idempoten.
 */
export async function processMidtransNotification(body: MidtransNotificationBody) {
  const tx = await prisma.midtransTransaction.findUnique({ where: { orderId: body.order_id } });
  if (!tx) return { handled: false as const, reason: "unknown_order" };

  const authoritative = await fetchTransactionStatus(body.order_id);

  // Nominal dari Midtrans harus sama dengan yang kita catat saat membuat transaksi.
  if (!new Prisma.Decimal(authoritative.gross_amount).equals(tx.grossAmount)) {
    throw new AppError("Nominal transaksi tidak cocok", 409, "AMOUNT_MISMATCH");
  }

  const status = authoritative.transaction_status;
  await prisma.midtransTransaction.update({
    where: { id: tx.id },
    data: {
      ...(isKnownStatus(status) ? { status } : {}),
      rawWebhookPayload: { webhook: body, verified: authoritative } as unknown as Prisma.InputJsonValue,
    },
  });

  const paid = status === "settlement" || (status === "capture" && authoritative.fraud_status === "accept");
  if (!paid) return { handled: true as const, credited: false, status };

  const result = await creditWallet({
    tenantId: tx.tenantId,
    amount: tx.grossAmount,
    type: "topup",
    referenceId: tx.orderId,
  });
  return { handled: true as const, credited: result.credited, status };
}

export async function getTopupStatus(tenantId: string, orderId: string) {
  const tx = await prisma.midtransTransaction.findFirst({ where: { tenantId, orderId } });
  if (!tx) throw new NotFoundError("Transaksi tidak ditemukan");
  return { orderId: tx.orderId, status: tx.status, grossAmount: tx.grossAmount.toString(), createdAt: tx.createdAt };
}
