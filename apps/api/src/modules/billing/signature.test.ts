import { describe, expect, it } from "vitest";
import { computeMidtransSignature, verifyMidtransSignature } from "./signature.js";

const SERVER_KEY = "SB-Mid-server-test-key";
const base = { order_id: "BWA-abc-1", status_code: "200", gross_amount: "50000.00" };

describe("verifyMidtransSignature", () => {
  it("menerima signature yang benar", () => {
    const signature_key = computeMidtransSignature(base.order_id, base.status_code, base.gross_amount, SERVER_KEY);
    expect(verifyMidtransSignature({ ...base, signature_key }, SERVER_KEY)).toBe(true);
  });

  it("menolak signature yang salah", () => {
    expect(verifyMidtransSignature({ ...base, signature_key: "00".repeat(64) }, SERVER_KEY)).toBe(false);
  });

  it("menolak kalau gross_amount dimanipulasi", () => {
    const signature_key = computeMidtransSignature(base.order_id, base.status_code, base.gross_amount, SERVER_KEY);
    expect(verifyMidtransSignature({ ...base, gross_amount: "1.00", signature_key }, SERVER_KEY)).toBe(false);
  });

  it("menolak signature dengan panjang tidak valid tanpa melempar error", () => {
    expect(verifyMidtransSignature({ ...base, signature_key: "abcd" }, SERVER_KEY)).toBe(false);
    expect(verifyMidtransSignature({ ...base, signature_key: "" }, SERVER_KEY)).toBe(false);
  });

  it("menolak kalau server key kosong (konfigurasi belum diisi)", () => {
    const signature_key = computeMidtransSignature(base.order_id, base.status_code, base.gross_amount, "");
    expect(verifyMidtransSignature({ ...base, signature_key }, "")).toBe(false);
  });
});
