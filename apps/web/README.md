# Bakulan WA — Frontend Web (PWA)

Dashboard mobile untuk backend Bakulan WA, dibuat dari mockup yang disetujui
user: konsep 4 (PWA, navigasi bawah: Beranda, Chat, Persona, Saldo) dengan isi
konsep 2 (dashboard bisnis), plus tema terang/gelap.

## Halaman

- `/` Beranda: nama usaha, status WhatsApp, total pesan & percakapan,
  saldo, dan percakapan terbaru. Angka diambil dari API, bukan dummy.
- `/login` Masuk / Daftar (POST /auth/login, POST /auth/register).
- `/chat` Daftar percakapan dan riwayat pesan (GET /conversations,
  GET /messages, POST /conversations/resume-ai).
- `/persona` Daftar, buat, aktifkan, hapus persona (GET/POST/PATCH
  /persona, POST /persona/:id/activate, DELETE /persona/:id).
- `/saldo` Saldo, riwayat wallet, top-up Midtrans (GET /billing/wallet,
  GET /billing/ledger, POST /billing/topup).
- `/wa` Status WhatsApp, QR, hubungkan/putuskan (GET /wa/status,
  POST /wa/connect, POST /wa/disconnect).

## Tema

Tombol di header mengubah tema terang/gelap. Pilihan disimpan di
`localStorage` dengan kunci `bakulan-theme`, dan diterapkan lewat atribut
`data-theme` di `<html>`. Kalau belum pernah memilih, tema mengikuti
`prefers-color-scheme` perangkat.

## Menjalankan

```bash
# dari root repo
cp apps/web/.env.example apps/web/.env.local
# isi NEXT_PUBLIC_API_URL, default http://localhost:3001
npm install
npm run dev --workspace=@bakulan/web
# atau dari apps/web: npm run dev  (port 3000)
```

Backend harus mengizinkan origin frontend lewat `WEB_ORIGIN`
(default backend: http://localhost:3000). Token login disimpan di
localStorage perangkat; access token backend berlaku 15 menit dan
di-refresh otomatis lewat POST /auth/refresh bila memungkinkan.

## Batasan yang diketahui

- Balasan manual tidak dikirim dari dashboard ini; sesuai desain backend,
  pemilik membalas dari HP WhatsApp, lalu AI diam selama masa handover.
  Dashboard hanya menyediakan tombol "Aktifkan AI lagi".
- File `package-lock.json` root dan `.github/workflows/ci.yml` belum ada
  di repo ini saat frontend ini dibuat (lihat riwayat push backend);
  jalankan `npm install` di root untuk membuat ulang lockfile bila perlu.
