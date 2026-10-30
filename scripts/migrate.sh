#!/usr/bin/env bash
# Terapkan migrasi database di server (Docker). Jalankan dari mana saja.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d packages/db/prisma/migrations ]; then
  echo "ERROR: folder packages/db/prisma/migrations belum ada."
  echo "Buat migrasi awal sekali di laptop (butuh internet):"
  echo "  docker run -d --name pg-tmp -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16-alpine"
  echo "  DATABASE_URL=postgresql://postgres:x@localhost:5432/postgres npm run db:migrate:dev -- --name init"
  echo "lalu commit folder migrations-nya."
  exit 1
fi

docker compose --env-file .env -f docker/docker-compose.yml up -d postgres redis
docker compose --env-file .env -f docker/docker-compose.yml run --rm api \
  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
