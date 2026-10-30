#!/usr/bin/env bash
# Bakulan WA — sekali jalan dengan Docker.
# Menjalankan: postgres + redis + api + wa-worker + ai-worker + web + caddy.
# Penggunaan dari root repo:
#   bash scripts/docker-up.sh
#   bash scripts/docker-up.sh --seed   # tambah akun demo + saldo uji (opsional)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker tidak ditemukan. Pakai Codespaces / VPS / laptop Linux dengan Docker, bukan terminal HP."
  exit 1
fi

if [ ! -f .env ]; then
  echo "ERROR: file .env belum ada."
  echo "Jalankan dulu: cp .env.example .env"
  echo "Lalu isi .env secara manual. JANGAN kirim isi .env asli ke AI/chat mana pun."
  echo "Yang wajib terisi untuk test lokal: POSTGRES_PASSWORD, JWT_ACCESS_SECRET,"
  echo "SESSION_ENCRYPTION_KEY (openssl rand -base64 32), dan API key AI yang dipakai."
  exit 1
fi

# Cek kasar: variabel wajib tidak boleh kosong.
missing=""
for var in POSTGRES_PASSWORD JWT_ACCESS_SECRET SESSION_ENCRYPTION_KEY; do
  value="$(grep -E "^${var}=" .env | head -n1 | cut -d= -f2- | tr -d '\"' | tr -d ' ' || true)"
  if [ -z "${value}" ]; then
    missing="${missing} ${var}"
  fi
done
if [ -n "${missing}" ]; then
  echo "ERROR: variabel berikut masih kosong di .env:${missing}"
  echo "Isi dulu, lalu jalankan lagi script ini."
  exit 1
fi

COMPOSE="docker compose --env-file .env -f docker/docker-compose.yml"

echo "== 1/4 Memulai postgres + redis =="
$COMPOSE up -d postgres redis

echo "== 2/4 Menyiapkan skema database =="
if [ -d packages/db/prisma/migrations ]; then
  echo "Folder migrations ditemukan, memakai prisma migrate deploy."
  $COMPOSE run --rm api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
else
  echo "Folder migrations belum ada, memakai prisma db push untuk test pertama."
  echo "Untuk deploy serius, buat migrations dulu di dev lalu commit foldernya."
  $COMPOSE run --rm api npx prisma db push --schema packages/db/prisma/schema.prisma
fi

echo "== 3/4 Membangun dan menjalankan semua service =="
$COMPOSE up -d --build

if [ "${1:-}" = "--seed" ]; then
  echo "== 4/4 Membuat akun demo =="
  $COMPOSE run --rm api node_modules/.bin/tsx apps/api/src/scripts/seed.ts
fi

echo ""
echo "Selesai. Cek status:"
echo "  $COMPOSE ps"
echo "  API:    http://localhost:3001/health"
echo "  Web:    http://localhost:3000"
echo "  Log:    $COMPOSE logs -f api web"
echo "Berhenti: $COMPOSE down"
echo "Catatan Codespaces: ganti WEB_PUBLIC_API_URL di .env ke URL forward port 3001,"
echo "dan masukkan URL forward port 3000 ke WEB_ORIGIN, lalu jalankan ulang script ini"
echo "supaya build web memakai URL API yang benar (NEXT_PUBLIC_API_URL dibaca saat build)."
