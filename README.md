# Bakulan WA — backend MVP

Platform AI auto-reply WhatsApp untuk UMKM, aktivasi lewat scan QR. Desain lengkap: `docs/MVP-TECHNICAL-DESIGN.md`.

## Struktur

| Folder | Fungsi |
|---|---|
| `apps/api` | Fastify: auth, tenant, persona, WA connect/status, billing (Midtrans), webhook, riwayat pesan |
| `apps/wa-worker` | Memegang socket Baileys per tenant: QR, reconnect, terima/kirim pesan |
| `apps/ai-worker` | Konsumsi pesan masuk → LLM → tagih saldo → antrekan balasan |
| `packages/db` | Skema Prisma + logika wallet (debit/kredit atomik, idempoten) |
| `packages/config` | Validasi env (gagal keras saat boot kalau salah) |
| `packages/shared-types` | Tipe job, nama antrean, key Redis, template persona |

## Menjalankan di laptop (dev)

```bash
cp .env.example .env            # isi JWT_ACCESS_SECRET, SESSION_ENCRYPTION_KEY, API key AI
openssl rand -base64 32         # -> SESSION_ENCRYPTION_KEY
docker run -d --name pg -e POSTGRES_USER=bakulan -e POSTGRES_PASSWORD=ganti-dengan-password-kuat \
  -e POSTGRES_DB=bakulan_wa -p 5432:5432 postgres:16-alpine
docker run -d --name redis -p 6379:6379 redis:7-alpine

npm install
npm run db:generate
npm run db:migrate:dev -- --name init     # membuat folder migrations (commit hasilnya)
npm run dev                                # api + wa-worker + ai-worker
```

## Sekali jalan (Docker Compose, backend + frontend)

```bash
cp .env.example .env                  # isi manual, JANGAN kirim isi .env ke AI/chat mana pun
bash scripts/docker-up.sh             # postgres + redis + api + wa-worker + ai-worker + web + caddy
bash scripts/docker-up.sh --seed      # opsional: tambah akun demo + saldo uji
# Web: http://localhost:3000  |  API: http://localhost:3001/health
# Berhenti: docker compose --env-file .env -f docker/docker-compose.yml down
```

Script itu mengecek `.env` ada dan variabel wajib terisi, lalu menyiapkan
skema database (migrate deploy kalau folder migrations ada, kalau tidak
pakai db push untuk test pertama), baru membangun dan menjalankan semua
service. Untuk Codespaces, isi `WEB_PUBLIC_API_URL` dengan URL forward port
3001 dan masukkan URL forward port 3000 ke `WEB_ORIGIN`, lalu jalankan
ulang script supaya build web memakai URL API yang benar.

## Deploy (VPS, Docker Compose)

```bash
cp .env.example .env && nano .env     # isi semua; API_DOMAIN = domain API kamu
bash scripts/docker-up.sh             # setara dengan langkah migrate + up di bawah, sekali jalan
bash scripts/seed.sh                  # opsional: akun demo + saldo uji
```

Jadwalkan `scripts/backup.sh` lewat cron dan simpan salinannya di luar VPS.

## Endpoint ringkas

`POST /auth/register|login|refresh|logout` · `GET/PATCH /tenants/me` · `GET /persona/templates` ·
`CRUD /persona` (+ `/:id/activate`) · `POST /wa/connect` · `GET /wa/status` · `POST /wa/disconnect` ·
`GET /billing/wallet|ledger` · `POST /billing/topup` · `GET /billing/topup/:orderId` ·
`POST /webhooks/midtrans` · `GET /conversations` · `GET /messages` · `POST /conversations/resume-ai` · `GET /health`

## Penyimpangan dari dokumen desain (disengaja)

- **Node 22**, bukan 20 — Node 20 sudah EOL (April 2026).
- **Baileys `7.0.0-rc14`** (dipin persis), bukan 6.x — 6.x berstatus `legacy` di npm. Ini RC; uji di nomor cadangan dulu.
- **Prisma 6.19.3** dipin — Prisma 7 mengubah cara konfigurasi datasource & membutuhkan driver adapter.
- **Tanpa SDK Midtrans**: Snap + Status API dipanggil via `fetch`. Webhook diverifikasi signature **dan** dikonfirmasi ulang ke Status API.
- **Skema**: `messages` + `contact_jid` & `wa_message_id` (memori per-kontak + idempotensi); `wa_sessions.tenant_id` unik (1 sesi/tenant);
  `wallet_ledger` unik `(type, reference_id)`; tabel `wallet_balances` untuk lock saldo.
- **Pesan fallback saldo habis** dikirim ke pelanggan sebagai kalimat netral ("admin akan membalas"), bukan "top up dulu" — pelanggan tenant tidak perlu tahu soal saldo. Maks 1x per kontak per 6 jam.
- **Handover**: kalau pemilik membalas manual dari HP, AI diam selama `HANDOVER_TTL_SECONDS` untuk kontak itu (janji di landing page).
- Menjalankan lewat `tsx` (tanpa langkah build) — cukup untuk MVP; kompilasi ke `dist/` bisa menyusul.

## Keterbatasan MVP yang perlu kamu tahu

- Hanya **teks 1-on-1**. Grup, media tanpa caption, voice note diabaikan.
- Auth state Baileys disimpan sebagai **satu blob terenkripsi per tenant**, ditulis ulang utuh (debounce 1 detik). Aman untuk ratusan tenant; pecah per-key bila satu sesi punya ribuan kontak.
- `SESSION_ENCRYPTION_KEY` hilang = semua tenant harus scan ulang. Backup key ini terpisah dari database.
- Risiko ban nomor oleh WhatsApp (protokol tidak resmi) tetap ada; pacing kirim (jeda + indikator mengetik) hanya mengurangi, tidak menghilangkan.
- Harga token di `.env.example` adalah **placeholder** — cek harga resmi provider sebelum menagih tenant.
