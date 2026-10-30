"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type Persona } from "../../lib/api";

export default function PersonaPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function load() {
    try {
      setPersonas(await api.personas());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat persona");
    }
  }
  useEffect(() => { load(); }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(""); setInfo("");
    try {
      await api.createPersona({ name, systemPrompt });
      setName(""); setSystemPrompt(""); setInfo("Persona dibuat.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat persona");
    }
  }

  return (
    <div>
      <h1>Persona AI</h1>
      <p className="muted">Persona menentukan gaya dan aturan balasan AI untuk tenant-mu.</p>
      {error && <p className="error">{error}</p>}
      {info && <p className="card">{info}</p>}
      {personas.map((p) => (
        <div className="card" key={p.id}>
          <strong>{p.name}</strong>
          <p className="muted">{p.systemPrompt.slice(0, 200)}</p>
          <button className="btn secondary" type="button" onClick={async () => { await api.activatePersona(p.id); await load(); }}>
            Aktifkan persona ini
          </button>{" "}
          <button className="btn danger" type="button" onClick={async () => { if (confirm("Hapus persona ini?")) { await api.deletePersona(p.id); await load(); } }}>
            Hapus
          </button>
        </div>
      ))}
      {personas.length === 0 && <p className="muted">Belum ada persona.</p>}
      <h2>Buat persona baru</h2>
      <form onSubmit={onCreate}>
        <label>Nama
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>System prompt (min. 10 karakter)
          <textarea className="input" rows={5} required value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
        </label>
        <button className="btn" type="submit">Simpan persona</button>
      </form>
    </div>
  );
}
