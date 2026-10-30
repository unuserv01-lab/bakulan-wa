import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Format blob: [versi 1 byte][IV 12 byte][auth tag 16 byte][ciphertext]
// Byte versi memungkinkan rotasi key / ganti algoritma nanti tanpa migrasi paksa.
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

export function loadKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("SESSION_ENCRYPTION_KEY harus 32 byte (base64)");
  return key;
}

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]);
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < 1 + IV_LEN + TAG_LEN) throw new Error("Blob terenkripsi terlalu pendek");
  if (blob[0] !== VERSION) throw new Error(`Versi enkripsi tidak dikenal: ${blob[0]}`);
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const data = blob.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // final() melempar error kalau data dimodifikasi atau key salah (autentikasi GCM).
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
