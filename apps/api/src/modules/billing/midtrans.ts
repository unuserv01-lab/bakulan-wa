import { env } from "@bakulan/config";
import { AppError } from "../../lib/errors.js";

// Midtrans dipanggil langsung lewat fetch (Snap + Status API) — tanpa SDK, jadi tidak ada
// dependensi tanpa tipe dan perilakunya mudah dibaca.
const SNAP_URL = env.MIDTRANS_IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";
const API_BASE = env.MIDTRANS_IS_PRODUCTION ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";

function authHeader(): string {
  if (!env.MIDTRANS_SERVER_KEY) throw new AppError("Pembayaran belum dikonfigurasi", 503, "PAYMENT_NOT_CONFIGURED");
  return "Basic " + Buffer.from(`${env.MIDTRANS_SERVER_KEY}:`).toString("base64");
}

export interface SnapResult {
  token: string;
  redirect_url: string;
}

export async function createSnapTransaction(params: {
  orderId: string;
  grossAmount: number;
  email: string;
  businessName: string;
}): Promise<SnapResult> {
  const res = await fetch(SNAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authHeader() },
    body: JSON.stringify({
      transaction_details: { order_id: params.orderId, gross_amount: params.grossAmount },
      item_details: [{ id: "topup", price: params.grossAmount, quantity: 1, name: "Top up saldo Bakulan WA" }],
      customer_details: { first_name: params.businessName.slice(0, 50), email: params.email },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new AppError(`Gagal membuat transaksi pembayaran (${res.status})`, 502, "PAYMENT_PROVIDER_ERROR");
  }
  return (await res.json()) as SnapResult;
}

export interface MidtransStatusResponse {
  order_id: string;
  status_code: string;
  gross_amount: string;
  transaction_status: string;
  fraud_status?: string;
  payment_type?: string;
}

/** Sumber kebenaran status pembayaran. Body webhook tidak dipercaya mentah — selalu dikonfirmasi ke sini. */
export async function fetchTransactionStatus(orderId: string): Promise<MidtransStatusResponse> {
  const res = await fetch(`${API_BASE}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: "application/json", Authorization: authHeader() },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new AppError(`Gagal cek status transaksi (${res.status})`, 502, "PAYMENT_PROVIDER_ERROR");
  }
  return (await res.json()) as MidtransStatusResponse;
}
