"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, formatRupiah, type Conversation, type Tenant, type WaStatus, type Wallet } from "../lib/api";

// Beranda: gabungan konsep 4 (PWA mobile, navigasi bawah) + konsep 2 (dashboard bisnis).
// Angka di sini HARUS dari API backend, bukan dummy. Kalau backend belum terhubung,
// tampilkan status error yang jelas, bukan angka contoh seolah-nyata.
export default function HomePage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [wa, setWa] = useState<WaStatus | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [t, w, wal, conv] = await Promise.all([
          api.tenant(),
          api.waStatus(),
          api.wallet(),
          api.conversations(),
        ]);
        setTenant(t);
        setWa(w);
        setWallet(wal);
        setConversations(conv);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalPesan = useMemo(
    () => conversations.reduce((sum, c) => sum + c.messageCount, 0),
    [conversations],
  );

  if (loading) return <p className="muted">Memuat dashboard…</p>;

  if (error) {
    return (
      <div>
        <h1>Belum terhubung ke backend</h1>
        <p className="error">{error}</p>
        <p className="muted">
          Pastikan backend jalan di <code>NEXT_PUBLIC_API_URL</code> dan kamu
          sudah login. Backend default lokal: http://localhost:3001, dan
          origin frontend harus diizinkan lewat WEB_ORIGIN backend.
        </p>
        <Link className="btn" href="/login">Ke halaman login</Link>
      </div>
    );
  }

  const waConnected = wa?.status === "connected";
  return (
    <div>
      <h1>Halo, {tenant?.businessName || "Usaha Anda"}</h1>
      <p>
        <span className={waConnected ? "pill" : "pill warn"}>
          {waConnected ? "AI Aktif" : `WhatsApp: ${wa?.status || "belum terhubung"}`}
        </span>
      </p>

      <div className="grid2">
        <div className="stat">
          <div className="label">Total Pesan (50 percakapan terakhir)</div>
          <div className="value">{totalPesan}</div>
        </div>
        <div className="stat">
          <div className="label">Percakapan</div>
          <div className="value">{conversations.length}</div>
        </div>
        <div className="stat">
          <div className="label">Saldo</div>
          <div className="value">{wallet ? formatRupiah(wallet.balance) : "-"}</div>
        </div>
        <div className="stat">
          <div className="label">Nomor WhatsApp</div>
          <div className="value" style={{ fontSize: 18 }}>{wa?.phoneNumber || "-"}</div>
        </div>
      </div>

      <div className="card">
        <strong>Status WhatsApp</strong>
        <p className="muted">
          {waConnected
            ? `Terhubung${wa?.phoneNumber ? ` sebagai ${wa.phoneNumber}` : ""}. AI akan membalas pesan masuk sesuai persona aktif.`
            : "Belum terhubung. Pindai QR untuk menghubungkan nomor WhatsApp usahamu."}
        </p>
        <Link className="btn" href="/wa">{waConnected ? "Kelola WhatsApp" : "Pindai QR"}</Link>
      </div>

      <div className="card">
        <strong>Percakapan terbaru</strong>
        {conversations.slice(0, 5).map((c) => (
          <p key={c.contactJid}>
            <Link href={`/chat?contact=${encodeURIComponent(c.contactJid)}`}>
              {c.contactJid} · {c.messageCount} pesan
            </Link>
          </p>
        ))}
        {conversations.length === 0 && <p className="muted">Belum ada percakapan.</p>}
        <Link className="btn secondary" href="/chat">Lihat semua chat</Link>
      </div>
    </div>
  );
}
