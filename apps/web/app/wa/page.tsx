"use client";

import { useEffect, useState } from "react";
import { api, type WaStatus } from "../../lib/api";

export default function WaPage() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setStatus(await api.waStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat status WhatsApp");
    }
  }

  useEffect(() => {
    load();
    // Backend menyarankan short-poll ~2 detik untuk QR sampai connected.
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div>
      <h1>WhatsApp</h1>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <p>Status: <strong>{status?.status || "-"}</strong></p>
        <p className="muted">Nomor: {status?.phoneNumber || "-"}</p>
        {status?.qr && (
          <div>
            <p>Pindai QR ini dari WhatsApp di HP usahamu:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qr" src={status.qr} alt="QR WhatsApp" />
          </div>
        )}
        <button className="btn" type="button" onClick={async () => { await api.waConnect(); await load(); }}>
          Hubungkan / Minta QR baru
        </button>{" "}
        <button className="btn danger" type="button" onClick={async () => { await api.waDisconnect(); await load(); }}>
          Putuskan
        </button>
      </div>
      <p className="muted">
        Peringatan dari backend: koneksi ini memakai protokol tidak resmi
        (Baileys/QR), bukan API resmi Meta. Ada risiko nomor diblokir.
        Gunakan nomor cadangan untuk uji coba.
      </p>
    </div>
  );
}
