import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, loadKey } from "./crypto.js";

const key = randomBytes(32);
const plain = Buffer.from(JSON.stringify({ creds: { a: 1 }, keys: {} }), "utf8");

describe("session crypto (AES-256-GCM)", () => {
  it("round-trip menghasilkan data semula", () => {
    expect(decrypt(encrypt(plain, key), key).equals(plain)).toBe(true);
  });

  it("IV acak: dua enkripsi data sama menghasilkan blob berbeda", () => {
    expect(encrypt(plain, key).equals(encrypt(plain, key))).toBe(false);
  });

  it("menolak key yang salah", () => {
    expect(() => decrypt(encrypt(plain, key), randomBytes(32))).toThrow();
  });

  it("mendeteksi data yang dimodifikasi", () => {
    const blob = encrypt(plain, key);
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    expect(() => decrypt(blob, key)).toThrow();
  });

  it("menolak blob terlalu pendek / versi tidak dikenal", () => {
    expect(() => decrypt(Buffer.from([1, 2, 3]), key)).toThrow();
    const blob = encrypt(plain, key);
    blob[0] = 99;
    expect(() => decrypt(blob, key)).toThrow(/Versi/);
  });

  it("loadKey menolak panjang key yang salah", () => {
    expect(() => loadKey(Buffer.alloc(16).toString("base64"))).toThrow();
    expect(loadKey(key.toString("base64")).length).toBe(32);
  });
});
