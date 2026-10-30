"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, setTokens } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, businessName);
      setTokens(data.accessToken, data.refreshToken);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>{mode === "login" ? "Masuk" : "Daftar"} Bakulan WA</h1>
      <p className="muted">Gunakan email dan password akun tenant-mu di backend.</p>
      {error && <p className="error">{error}</p>}
      <form onSubmit={onSubmit}>
        <label>Email
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mode === "register" && (
          <label>Nama usaha
            <input className="input" required minLength={2} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </label>
        )}
        <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
        </button>
      </form>
      <p>
        <button className="btn secondary" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </p>
      <p className="muted">
        Token disimpan di perangkat ini (localStorage). Backend access token
        berlaku 15 menit dan akan di-refresh otomatis lewat /auth/refresh.
      </p>
      <p><Link href="/">Kembali ke Beranda</Link></p>
    </div>
  );
}
