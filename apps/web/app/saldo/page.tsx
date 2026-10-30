"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, formatRupiah, type Wallet } from "../../lib/api";

export default function SaldoPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [entries, setEntries] = useState<Array<{ id: string; type: string; amount: string; balanceAfter: string; createdAt: string }>>([]);
  const [amount, setAmount] = useState(50000);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setWallet(await api.wallet());
        const ledger = await api.ledger();
        setEntries(ledger.entries);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat saldo");
      }
    })();
  }, []);

  async function onTopup(e: FormEvent) {
    e.preventDefault();
    setError(""); setInfo("");
    try {
      const result = await api.topup(amount) as { redirectUrl?: string; snapToken?: string; orderId?: string };
      setInfo(`Top-up dibuat. Order: ${result.orderId || "-"}. Ikuti tautan pembayaran dari Midtrans bila tersedia, lalu saldo akan bertambah setelah webhook terverifikasi.`);
      if (result.redirectUrl) window.open(result.redirectUrl, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat top-up");
    }
  }

  return (
    <div>
      <h1>Saldo</h1>
      {error && <p className="error">{error}</p>}
      {info && <p className="card">{info}</p>}
      <div className="card">
        <div className="label muted">Saldo saat ini</div>
        <div style={{ fontSize: 32, fontWeight: 800 }}>{wallet ? formatRupiah(wallet.balance) : "-"}</div>
        {wallet?.lowBalance && <p className="error">Saldo rendah: AI bisa berhenti membalas bila saldo di bawah batas minimum backend.</p>}
        {wallet && <p className="muted">Top-up diizinkan {formatRupiah(wallet.topupMin)} – {formatRupiah(wallet.topupMax)}.</p>}
      </div>
      <h2>Top-up (Midtrans)</h2>
      <form onSubmit={onTopup}>
        <label>Nominal (Rp)
          <input className="input" type="number" required value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <button className="btn" type="submit">Buat top-up</button>
      </form>
      <h2>Riwayat wallet</h2>
      {entries.map((row) => (
        <div className="card" key={row.id}>
          <strong>{row.type}</strong> · {formatRupiah(row.amount)}
          <div className="muted">Saldo setelah: {formatRupiah(row.balanceAfter)} · {new Date(row.createdAt).toLocaleString("id-ID")}</div>
        </div>
      ))}
      {entries.length === 0 && <p className="muted">Belum ada riwayat wallet.</p>}
    </div>
  );
}
