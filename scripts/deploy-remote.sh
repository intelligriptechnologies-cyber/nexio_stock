#!/usr/bin/env bash
# Runs on the Hetzner server, from /opt/barstock, after `git pull`.
# Usage: scripts/deploy-remote.sh <production|staging>
#
# Same build / up / ps as before, plus: if the new image has Alembic
# migrations the database hasn't applied yet, back up the DB first, then
# migrate, then swap containers. A failed backup or migration aborts the
# deploy (set -e) and leaves the running containers untouched.
set -euo pipefail

ENV_NAME="${1:?usage: deploy-remote.sh <production|staging>}"
case "$ENV_NAME" in production | staging) ;; *) echo "unknown env: $ENV_NAME" >&2; exit 2 ;; esac

C=(docker compose --env-file ".env.$ENV_NAME" -f "deploy/compose.$ENV_NAME.yaml")
BACKUP_DIR="${BACKUP_DIR:-/opt/barstock/backups/$ENV_NAME}"
KEEP_BACKUPS=14

"${C[@]}" build
"${C[@]}" up -d db

# Ask the NEW image which revision is head and which one the DB is at.
alembic() { "${C[@]}" run --rm --no-deps -T backend uv run alembic "$@" 2>/dev/null; }
HEAD_REV="$(alembic heads | grep -oE '^[0-9a-z]+' | head -n1)"
CURRENT="$(alembic current | grep -oE '^[0-9a-z]+' | head -n1 || true)"

if [ -z "$HEAD_REV" ]; then
  echo "could not determine alembic head; aborting" >&2
  exit 1
fi

if [ "$CURRENT" != "$HEAD_REV" ]; then
  echo "Pending migrations: DB at '${CURRENT:-none}', head is '$HEAD_REV'"
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/pre-${HEAD_REV}-$(date +%Y%m%d-%H%M%S).sql.gz"
  "${C[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$BACKUP"
  [ -s "$BACKUP" ] || { echo "backup is empty; aborting" >&2; rm -f "$BACKUP"; exit 1; }
  echo "Backup written: $BACKUP ($(du -h "$BACKUP" | cut -f1))"
  "${C[@]}" run --rm --no-deps -T backend uv run alembic upgrade head
  ls -1t "$BACKUP_DIR"/*.sql.gz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
else
  echo "Database already at head ($HEAD_REV); no migration needed"
fi

"${C[@]}" up -d
"${C[@]}" ps
