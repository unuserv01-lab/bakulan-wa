import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  type BaileysEventMap,
  type ConnectionState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { Prisma, prisma } from "@bakulan/db";
import { env } from "@bakulan/config";
import { redisKeys, type IncomingMessageJob } from "@bakulan/shared-types";
import { sendAlert } from "../alert.js";
import { baileysLogger, logger } from "../logger.js";
import { INCOMING_JOB_OPTS, incomingQueue, redis } from "../queue/queues.js";
import { randomBetween, sleep, toSeconds } from "../util.js";
import { loadKey } from "./crypto.js";
import { useDbAuthState, type DbAuthState } from "./dbAuthState.js";

type SessionStatus = "pending_qr" | "connected" | "disconnected" | "logged_out";

interface Managed {
  waSessionId: string;
  tenantId: string;
  sock?: WASocket;
  auth?: DbAuthState;
  open: boolean;
  retry: number;
  reconnectTimer?: NodeJS.Timeout;
  stopping: boolean;
}

const MAX_TEXT_LENGTH = 2000;

// Hanya chat 1-on-1. Grup, broadcast/status, dan newsletter diabaikan di MVP.
const isDirectChat = (jid: string) => jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");

function extractText(msg: WAMessage): string | null {
  const content = normalizeMessageContent(msg.message);
  const text =
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    null;
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT_LENGTH) : null;
}

export class SessionManager {
  private sessions = new Map<string, Managed>();
  private starting = new Set<string>();
  private readonly key = loadKey(env.SESSION_ENCRYPTION_KEY);

  // ---------- query ----------
  getOpenSocket(waSessionId: string): WASocket | undefined {
    const m = this.sessions.get(waSessionId);
    return m?.open ? m.sock : undefined;
  }

  stats() {
    let open = 0;
    for (const m of this.sessions.values()) if (m.open) open++;
    return { total: this.sessions.size, open };
  }

  // ---------- lifecycle ----------

  /** Saat worker boot: lanjutkan semua sesi yang punya kredensial (atau sedang menunggu QR). */
  async startAll(): Promise<void> {
    const rows = await prisma.waSession.findMany({
      where: {
        status: { in: ["pending_qr", "connected", "disconnected"] },
        OR: [{ status: "pending_qr" }, { authStateEncrypted: { not: null } }],
      },
      select: { id: true },
    });
    logger.info({ count: rows.length }, "memulai sesi tersimpan");
    for (const r of rows) {
      await this.start(r.id);
      await sleep(500); // stagger: hindari lonjakan koneksi serentak
    }
  }

  async start(waSessionId: string): Promise<void> {
    if (this.starting.has(waSessionId)) return;
    const current = this.sessions.get(waSessionId);
    if (current && (current.sock || current.reconnectTimer)) return; // sudah jalan / sudah dijadwalkan
    this.starting.add(waSessionId);
    try {
      await this.spawn(waSessionId);
    } catch (err) {
      this.sessions.delete(waSessionId); // reconcile akan mencoba lagi
      logger.error({ err, waSessionId }, "gagal memulai sesi");
    } finally {
      this.starting.delete(waSessionId);
    }
  }

  private async spawn(waSessionId: string): Promise<void> {
    const row = await prisma.waSession.findUnique({
      where: { id: waSessionId },
      select: { tenantId: true, status: true },
    });
    if (!row || row.status === "logged_out") return;

    const managed: Managed = this.sessions.get(waSessionId) ?? {
      waSessionId,
      tenantId: row.tenantId,
      open: false,
      retry: 0,
      stopping: false,
    };
    managed.stopping = false;
    managed.reconnectTimer = undefined;
    this.sessions.set(waSessionId, managed);

    const auth = await useDbAuthState(waSessionId, this.key);
    managed.auth = auth;

    // Versi protokol WA terbaru (fetch ke GitHub). Gagal -> pakai versi bawaan library.
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: auth.state.creds,
        keys: makeCacheableSignalKeyStore(auth.state.keys, baileysLogger),
      },
      // Tampil di "Perangkat tertaut" di HP tenant.
      browser: ["Bakulan WA", "Chrome", "1.0.0"],
      logger: baileysLogger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });
    managed.sock = sock;
    managed.open = false;

    sock.ev.on("creds.update", () => void auth.saveCreds());
    sock.ev.on("connection.update", (update) => void this.onConnectionUpdate(managed, sock, update));
    sock.ev.on("messages.upsert", (upsert) => void this.onMessages(managed, sock, upsert));
  }

  /** Hentikan sesi. logout=true: cabut tautan perangkat di WhatsApp dan hapus kredensial. */
  async stop(waSessionId: string, opts: { logout: boolean }): Promise<void> {
    const m = this.sessions.get(waSessionId);
    if (!m) {
      if (opts.logout) await this.markLoggedOut(waSessionId);
      return;
    }
    m.stopping = true;
    if (m.reconnectTimer) clearTimeout(m.reconnectTimer);

    if (opts.logout && m.sock) {
      try {
        await m.sock.logout();
      } catch (err) {
        logger.warn({ err, waSessionId }, "logout WA gagal (mungkin sudah terputus)");
      }
    }
    await this.teardown(m, { clearAuth: opts.logout });
    this.sessions.delete(waSessionId);
    if (opts.logout) await this.markLoggedOut(waSessionId);
  }

  /** Dipanggil saat worker dimatikan: simpan state, tutup socket TANPA logout. */
  async shutdown(): Promise<void> {
    for (const m of this.sessions.values()) {
      m.stopping = true;
      if (m.reconnectTimer) clearTimeout(m.reconnectTimer);
      await this.teardown(m, { clearAuth: false });
    }
    this.sessions.clear();
  }

  private async teardown(m: Managed, opts: { clearAuth: boolean }): Promise<void> {
    m.open = false;
    try {
      m.sock?.end(undefined);
    } catch {
      /* socket sudah tertutup */
    }
    m.sock = undefined;
    if (opts.clearAuth) {
      m.auth?.dispose();
    } else {
      await m.auth?.flush();
      m.auth?.dispose();
    }
    m.auth = undefined;
  }

  // ---------- connection events ----------

  private async onConnectionUpdate(m: Managed, sock: WASocket, update: Partial<ConnectionState>): Promise<void> {
    if (m.sock !== sock) return; // event dari socket lama
    try {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        await redis.set(redisKeys.waQr(m.waSessionId), dataUrl, "EX", 60);
        await this.setStatus(m.waSessionId, "pending_qr");
      }
      if (connection === "open") await this.onOpen(m, sock);
      if (connection === "close") await this.onClose(m, sock, lastDisconnect?.error);
    } catch (err) {
      logger.error({ err, waSessionId: m.waSessionId }, "error di connection.update");
    }
  }

  private async onOpen(m: Managed, sock: WASocket): Promise<void> {
    m.open = true;
    m.retry = 0;
    await redis.del(redisKeys.waQr(m.waSessionId));

    const jid = sock.user?.id;
    const phone = jid ? jidNormalizedUser(jid).split("@")[0]! : null;

    try {
      await prisma.waSession.update({
        where: { id: m.waSessionId },
        data: { status: "connected", phoneNumber: phone, lastConnectedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Nomor yang sama sudah terhubung di tenant lain: lepas sesi ini.
        await sendAlert(`Nomor ${phone} sudah terhubung di tenant lain; sesi ${m.waSessionId} dilepas.`);
        await this.stop(m.waSessionId, { logout: true });
        return;
      }
      throw err;
    }
    logger.info({ waSessionId: m.waSessionId, phone }, "WhatsApp terhubung");
  }

  private async onClose(m: Managed, sock: WASocket, error: Error | undefined): Promise<void> {
    if (m.stopping || m.sock !== sock) return;
    const wasOpen = m.open;
    m.open = false;

    const code = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
    const registered = m.auth?.state.creds.registered ?? false;
    logger.info({ waSessionId: m.waSessionId, code, wasOpen }, "koneksi WA tertutup");

    switch (code) {
      case DisconnectReason.loggedOut: // 401: tenant mencabut tautan dari HP
      case DisconnectReason.badSession: // 500: state rusak, tidak bisa dipulihkan
        await this.teardown(m, { clearAuth: true });
        this.sessions.delete(m.waSessionId);
        await this.markLoggedOut(m.waSessionId);
        return;

      case DisconnectReason.connectionReplaced: // 440: sesi dibuka di tempat lain; JANGAN rebutan
        await this.halt(m, "Sesi digantikan koneksi lain (connectionReplaced)");
        return;

      case DisconnectReason.forbidden: // 403: nomor kemungkinan dibatasi/diblokir WA; jangan dipaksa
        await this.halt(m, "WhatsApp menolak koneksi (403) — nomor mungkin dibatasi");
        return;

      case DisconnectReason.restartRequired: // 515: NORMAL tepat setelah scan QR
        await this.teardown(m, { clearAuth: false });
        await this.spawn(m.waSessionId);
        return;

      case DisconnectReason.timedOut: // 408 saat belum pernah terdaftar = QR kedaluwarsa tanpa di-scan
        if (!registered) {
          await this.teardown(m, { clearAuth: false });
          this.sessions.delete(m.waSessionId);
          await this.setStatus(m.waSessionId, "disconnected");
          return;
        }
        break;
    }

    // Putus biasa: sambung ulang dengan exponential backoff + jitter.
    await this.setStatus(m.waSessionId, "disconnected", wasOpen ? { lastConnectedAt: new Date() } : {});
    await this.teardown(m, { clearAuth: false });
    const delay = Math.min(60_000, 2_000 * 2 ** m.retry) + randomBetween(0, 1000);
    m.retry++;
    m.reconnectTimer = setTimeout(() => {
      m.reconnectTimer = undefined;
      this.spawn(m.waSessionId).catch((err) => {
        this.sessions.delete(m.waSessionId);
        logger.error({ err, waSessionId: m.waSessionId }, "reconnect gagal");
      });
    }, delay);
  }

  /** Berhenti tanpa reconnect otomatis dan tanpa menghapus kredensial; kabari operator. */
  private async halt(m: Managed, reason: string): Promise<void> {
    await this.teardown(m, { clearAuth: false });
    this.sessions.delete(m.waSessionId);
    await this.setStatus(m.waSessionId, "disconnected", { lastConnectedAt: new Date() });
    await sendAlert(`Sesi ${m.waSessionId} (tenant ${m.tenantId}) dihentikan: ${reason}`);
  }

  private async setStatus(
    waSessionId: string,
    status: SessionStatus,
    extra: Prisma.WaSessionUpdateInput = {},
  ): Promise<void> {
    try {
      await prisma.waSession.update({ where: { id: waSessionId }, data: { status, ...extra } });
    } catch (err) {
      logger.warn({ err, waSessionId, status }, "gagal update status sesi");
    }
  }

  // phone_number dikosongkan supaya nomor yang sama bisa ditautkan lagi (kolomnya unik).
  private async markLoggedOut(waSessionId: string): Promise<void> {
    await redis.del(redisKeys.waQr(waSessionId));
    await this.setStatus(waSessionId, "logged_out", { authStateEncrypted: null, phoneNumber: null });
  }

  // ---------- pesan masuk ----------

  private async onMessages(m: Managed, sock: WASocket, upsert: BaileysEventMap["messages.upsert"]): Promise<void> {
    if (m.sock !== sock) return;
    for (const msg of upsert.messages) {
      try {
        await this.handleMessage(m, upsert.type, msg);
      } catch (err) {
        logger.error({ err, waSessionId: m.waSessionId }, "gagal memproses pesan masuk");
      }
    }
  }

  private async handleMessage(m: Managed, type: BaileysEventMap["messages.upsert"]["type"], msg: WAMessage) {
    const jid = msg.key.remoteJid;
    const waMessageId = msg.key.id;
    if (!jid || !waMessageId || !isDirectChat(jid)) return;
    if (type !== "notify") return; // abaikan sinkronisasi riwayat

    const ageSeconds = Date.now() / 1000 - toSeconds(msg.messageTimestamp);

    if (msg.key.fromMe) {
      // Pemilik membalas manual dari HP -> AI diam sementara untuk kontak ini.
      if (ageSeconds < 120) void this.maybeHandover(m, jid, waMessageId);
      return;
    }

    // Pesan lama (mis. menumpuk saat worker mati) diabaikan supaya tidak membanjiri balasan & biaya AI.
    if (ageSeconds > env.MAX_MESSAGE_AGE_SECONDS) return;

    const content = extractText(msg);
    if (!content) return; // media tanpa teks belum didukung di MVP

    const job: IncomingMessageJob = {
      tenantId: m.tenantId,
      waSessionId: m.waSessionId,
      contactJid: jid,
      content,
      waMessageId,
      receivedAt: new Date().toISOString(),
    };
    // jobId deterministik = dedupe kalau WA mengirim event yang sama dua kali.
    await incomingQueue.add("incoming", job, { ...INCOMING_JOB_OPTS, jobId: `${m.waSessionId}_${waMessageId}` });
  }

  private async maybeHandover(m: Managed, jid: string, waMessageId: string): Promise<void> {
    try {
      // Beri waktu worker pengirim menandai pesan bot sebelum kita menilai "ini pesan manual".
      await sleep(2500);
      if (await redis.exists(redisKeys.botSent(waMessageId))) return;
      await redis.set(redisKeys.handover(m.waSessionId, jid), "1", "EX", env.HANDOVER_TTL_SECONDS);
      logger.info({ waSessionId: m.waSessionId, jid }, "pemilik membalas manual — AI dijeda");
    } catch (err) {
      logger.warn({ err }, "gagal memproses handover");
    }
  }

  // ---------- pesan keluar ----------

  /** Kirim teks dengan ritme mirip manusia (jeda + indikator mengetik) — mengurangi risiko dianggap bot. */
  async sendText(waSessionId: string, jid: string, text: string): Promise<void> {
    const sock = this.getOpenSocket(waSessionId);
    if (!sock) throw new Error("Socket WhatsApp belum terhubung"); // BullMQ akan retry dengan backoff

    await sleep(randomBetween(600, 1500));
    await sock.sendPresenceUpdate("composing", jid);
    await sleep(Math.min(3500, 400 + text.length * 25));
    const sent = await sock.sendMessage(jid, { text });
    if (sent?.key.id) await redis.set(redisKeys.botSent(sent.key.id), "1", "EX", 300);
    await sock.sendPresenceUpdate("paused", jid).catch(() => undefined);
  }

  // ---------- operasi berkala ----------

  /** Tiap 30 detik: nyalakan sesi yang seharusnya aktif tapi belum punya socket (mis. pesan pub/sub terlewat). */
  async reconcile(): Promise<void> {
    const rows = await prisma.waSession.findMany({
      where: { status: { in: ["pending_qr", "connected"] } },
      select: { id: true },
    });
    for (const r of rows) {
      if (!this.sessions.has(r.id) && !this.starting.has(r.id)) {
        logger.info({ waSessionId: r.id }, "reconcile: menyalakan sesi tanpa socket");
        await this.start(r.id);
        await sleep(500);
      }
    }
  }

  /** Tiap 5 menit: beri tahu operator kalau ada sesi yang putus lebih dari 15 menit. */
  async checkDown(): Promise<void> {
    const cutoff = new Date(Date.now() - 15 * 60_000);
    const rows = await prisma.waSession.findMany({
      where: { status: "disconnected", authStateEncrypted: { not: null }, lastConnectedAt: { lt: cutoff } },
      select: { id: true, tenantId: true, phoneNumber: true },
    });
    for (const r of rows) {
      const first = await redis.set(redisKeys.downAlert(r.id), "1", "EX", 3600, "NX"); // maks 1 alert/jam/sesi
      if (first) await sendAlert(`Sesi ${r.id} (tenant ${r.tenantId}, ${r.phoneNumber ?? "-"}) putus > 15 menit.`);
    }
  }
}
