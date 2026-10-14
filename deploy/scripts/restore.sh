#!/usr/bin/env bash
# Replaces the live database with a backup. Run as root on the server.
#
#   restore.sh <backup.db.age> <age-identity-file>
#
# Asks for confirmation. The current database is kept next to it (never deleted), the backup is
# checked before anything changes, and the service is restarted and checked afterwards.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
source "$here/lib.sh"

backup="${1:?usage: restore.sh <backup.db.age> <identity-file>}"
identity="${2:?usage: restore.sh <backup.db.age> <identity-file>}"
db_path="${DB_PATH:-/var/lib/tuition/tuition.db}"
service="${SERVICE:-tuition}"
[[ $EUID -eq 0 ]] || die "run as root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age --decrypt -i "$identity" -o "$work/tuition.db" "$backup"
ops verify --db "$work/tuition.db" >"$work/report.json" || die "the backup failed the integrity check; nothing was changed"
log "backup is valid: $(tr -d '\n' <"$work/report.json" | grep -o '"counts":{[^}]*}')"

read -r -p "This replaces the live database with $(basename "$backup"). Type RESTORE to continue: " answer
[[ "$answer" == "RESTORE" ]] || die "cancelled; nothing was changed"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
systemctl stop "$service"
for ext in "" -wal -shm; do
  [[ -e "$db_path$ext" ]] && mv "$db_path$ext" "$db_path$ext.before-restore-$ts"
done
install -o tuition -g tuition -m 0600 "$work/tuition.db" "$db_path"
systemctl start "$service"

for _ in $(seq 1 30); do
  if curl -fsS "${HEALTH_URL:-http://127.0.0.1:3000/health}" >/dev/null 2>&1; then
    log "restored; the previous database is kept as $db_path.before-restore-$ts"
    exit 0
  fi
  sleep 1
done
die "the service did not come back; the previous database is at $db_path.before-restore-$ts"
