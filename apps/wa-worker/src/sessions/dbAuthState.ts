import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
} from "@whiskeysockets/baileys";
import { prisma } from "@bakulan/db";
import { logger } from "../logger.js";
import { decrypt, encrypt } from "./crypto.js";

export interface DbAuthState {
  state: AuthenticationState;
  /** Dipanggil Baileys saat creds berubah. Penyimpanan di-debounce. */
  saveCreds: () => Promise<void>;
  /** Paksa simpan sekarang (dipanggil sebelum socket dimatikan/disambung ulang). */
  flush: () => Promise<void>;
  /** Hentikan semua penulisan (dipakai saat logout supaya state lama tidak "hidup lagi"). */
  dispose: () => void;
}

const DEBOUNCE_MS = 1000;

/**
 * Pengganti useMultiFileAuthState: seluruh auth state (creds + signal keys) disimpan sebagai
 * satu blob JSON terenkripsi AES-256-GCM di kolom wa_sessions.auth_state, bukan di disk container
 * (disk hilang saat redeploy).
 *
 * Catatan skala: blob ditulis ulang utuh (debounce 1 detik). Cukup untuk ratusan tenant; kalau
 * satu sesi punya ribuan kontak, pecah jadi satu baris per key.
 */
export async function useDbAuthState(waSessionId: string, key: Buffer): Promise<DbAuthState> {
  const row = await prisma.waSession.findUnique({
    where: { id: waSessionId },
    select: { authStateEncrypted: true },
  });

  let creds: AuthenticationCreds;
  const store: Record<string, Record<string, unknown>> = {};

  if (row?.authStateEncrypted) {
    const json = decrypt(Buffer.from(row.authStateEncrypted), key).toString("utf8");
    const parsed = JSON.parse(json, BufferJSON.reviver) as {
      creds: AuthenticationCreds;
      keys?: Record<string, Record<string, unknown>>;
    };
    creds = parsed.creds;
    Object.assign(store, parsed.keys ?? {});
  } else {
    creds = initAuthCreds();
  }

  let disposed = false;
  let dirty = false;
  let timer: NodeJS.Timeout | undefined;
  let chain: Promise<void> = Promise.resolve();

  const write = async () => {
    if (disposed || !dirty) return;
    dirty = false;
    try {
      const json = JSON.stringify({ creds, keys: store }, BufferJSON.replacer);
      const blob = encrypt(Buffer.from(json, "utf8"), key);
      await prisma.waSession.update({
        where: { id: waSessionId },
        data: { authStateEncrypted: new Uint8Array(blob) },
      });
    } catch (err) {
      dirty = true; // coba lagi pada penulisan berikutnya
      logger.error({ err, waSessionId }, "gagal menyimpan auth state");
    }
  };

  const schedule = () => {
    dirty = true;
    if (disposed || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      chain = chain.then(write);
    }, DEBOUNCE_MS);
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const bucket = store[type] ?? {};
        const out: Record<string, unknown> = {};
        for (const id of ids) {
          let value = bucket[id];
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
          }
          if (value !== undefined) out[id] = value;
        }
        return out as never;
      },
      set: async (data) => {
        for (const category of Object.keys(data)) {
          const bucket = (store[category] ??= {});
          const entries = (data as Record<string, Record<string, unknown> | undefined>)[category] ?? {};
          for (const id of Object.keys(entries)) {
            const value = entries[id];
            if (value) bucket[id] = value;
            else delete bucket[id];
          }
        }
        schedule();
      },
    },
  };

  return {
    state,
    saveCreds: async () => schedule(),
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      chain = chain.then(write);
      await chain;
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
