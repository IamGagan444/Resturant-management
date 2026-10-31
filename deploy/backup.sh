#!/bin/sh
# Nightly Postgres backup (runs inside the `backup` container).
#   - dump at 21:30 UTC (03:00 IST, after closing), compressed
#   - keep the newest 7 on the server (volume `backups`)
#   - copy to s3://$BACKUP_S3_BUCKET/db/ when a bucket is configured (use a PRIVATE bucket + lifecycle rule)
# Restore: see docs/deploy-aws.md
set -eu

if [ -n "${BACKUP_S3_BUCKET:-}" ] && ! command -v aws >/dev/null 2>&1; then
  apk add --no-cache aws-cli >/dev/null
fi

backup() {
  file="/backups/rms-$(date -u +%Y%m%d-%H%M%S).sql.gz"
  pg_dump --no-owner --format=plain | gzip -9 > "$file.tmp"
  mv "$file.tmp" "$file"
  echo "backup: wrote $file ($(du -h "$file" | cut -f1))"
  ls -1t /backups/rms-*.sql.gz | tail -n +8 | xargs -r rm -f
  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    aws s3 cp "$file" "s3://$BACKUP_S3_BUCKET/db/$(basename "$file")" --only-show-errors && echo "backup: copied to s3://$BACKUP_S3_BUCKET/db/"
  fi
}

backup # one right away, so a fresh deploy is protected
while true; do
  now=$(date +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) 21:30" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup || echo "backup: FAILED"
done
