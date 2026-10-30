"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, shortContact, type ChatMessage, type Conversation } from "../../lib/api";

function ChatInner() {
  const params = useSearchParams();
  const selected = params.get("contact") || "";
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.conversations().then(setConversations).catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat chat"));
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.messages(selected).then((d) => setMessages([...d.messages].reverse())).catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat pesan"));
  }, [selected]);

  return (
    <div>
      <h1>Chat</h1>
      {error && <p className="error">{error}</p>}
      {!selected && (
        <div className="card">
          <strong>Pilih percakapan</strong>
          {conversations.map((c) => (
            <p key={c.contactJid}>
              <a href={`/chat?contact=${encodeURIComponent(c.contactJid)}`}>
                {shortContact(c.contactJid)} · {c.messageCount} pesan
              </a>
            </p>
          ))}
          {conversations.length === 0 && <p className="muted">Belum ada percakapan.</p>}
        </div>
      )}
      {selected && (
        <div>
          <p><a href="/chat">← Semua chat</a></p>
          <h2>{shortContact(selected)}</h2>
          <button
            className="btn secondary"
            type="button"
            onClick={async () => {
              await api.resumeAi(selected);
              alert("AI diaktifkan lagi untuk kontak ini.");
            }}
          >
            Aktifkan AI lagi (Ambil Alih Manual berakhir)
          </button>
          <p className="muted">
            Catatan: backend ini hanya menampilkan riwayat. Balasan manual
            dilakukan dari HP WhatsApp pemilik; setelah itu AI diam selama masa
            handover, dan tombol di atas mengaktifkan AI lebih cepat.
          </p>
          {messages.map((m) => (
            <div key={m.id} className={m.direction === "outbound" ? "bubble out" : "bubble in"}>
              {m.content}
              <div className="muted">{new Date(m.createdAt).toLocaleString("id-ID")}</div>
            </div>
          ))}
          {messages.length === 0 && <p className="muted">Belum ada pesan untuk kontak ini.</p>}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<p className="muted">Memuat chat…</p>}>
      <ChatInner />
    </Suspense>
  );
}
