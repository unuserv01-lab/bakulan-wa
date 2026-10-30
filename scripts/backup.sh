#!/usr/bin/env bash
# Backup Postgres (berisi ledger saldo + sesi WA terenkripsi). Jadwalkan via cron, mis. harian.
# Contoh cron:  0 3 * * *  /path/ke/bakulan-wa/scripts/backup.sh
# Simpan hasilnya di luar VPS (mis. Alibaba OSS) — backup di disk yang sama tidak menyelamatkan dari disk rusak.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
FILE="backups/bakulan_wa_$(date +%Y%m%d_%H%M%S).sql.gz"
docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U bakulan bakulan_wa | gzip > "$FILE"

# Simpan 14 backup terakhir saja.
ls -1t backups/*.sql.gz | tail -n +15 | xargs -r rm --
echo "Backup tersimpan: $FILE"
