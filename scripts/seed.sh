#!/usr/bin/env bash
# Buat akun demo + saldo uji Rp50.000 (idempoten). Password demo ditampilkan sekali di output.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose --env-file .env -f docker/docker-compose.yml run --rm api \
  node_modules/.bin/tsx apps/api/src/scripts/seed.ts
