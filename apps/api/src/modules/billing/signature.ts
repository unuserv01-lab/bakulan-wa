import { createHash, timingSafeEqual } from "node:crypto";

// Midtrans: signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)
export function computeMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash("sha512").update(orderId + statusCode + grossAmount + serverKey).digest("hex");
}

export function verifyMidtransSignature(
  body: { order_id: string; status_code: string; gross_amount: string; signature_key: string },
  serverKey: string,
): boolean {
  if (!serverKey) return false;
  const expected = Buffer.from(
    computeMidtransSignature(body.order_id, body.status_code, body.gross_amount, serverKey),
    "hex",
  );
  const given = Buffer.from(body.signature_key, "hex");
  // timingSafeEqual melempar error kalau panjang beda, jadi cek dulu.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
