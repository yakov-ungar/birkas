#!/usr/bin/env bash
# Proves a backup can be restored, without touching the live system:
# decrypts into a private temporary folder, runs the integrity checks, starts a second copy of
# the server on that database (another port, scheduler off) and asks it for /health.
#
#   verify-restore.sh <backup.db.age> <age-identity-file>
#
# The identity (private key) is yours and lives outside the server (D4). Run this on a machine
# where you may use it, e.g. a fresh VM, to check the "restore on a clean machine" path.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
source "$here/lib.sh"

backup="${1:?usage: verify-restore.sh <backup.db.age> <identity-file>}"
identity="${2:?usage: verify-restore.sh <backup.db.age> <identity-file>}"
[[ -f "$backup" ]] || die "no such file: $backup"
if [[ -f "$backup.sha256" ]]; then
  (cd "$(dirname "$backup")" && sha256sum --quiet -c "$(basename "$backup").sha256") || die "checksum mismatch"
fi

work="$(mktemp -d)"
pid=""
# Called by the trap (SC2317 in older shellcheck, SC2329 in newer).
# shellcheck disable=SC2317,SC2329
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

age --decrypt -i "$identity" -o "$work/tuition.db" "$backup"
ops verify --db "$work/tuition.db" | tee "$work/report.json"

port="${VERIFY_PORT:-3999}"
DATABASE_URL="file:$work/tuition.db" PORT="$port" HOST=127.0.0.1 SCHEDULER_ENABLED=false WEB_DIST='' \
  "$NODE_BIN" --env-file="$APP_ENV_FILE" "$APP_DIR/dist/main.js" >"$work/server.log" 2>&1 &
pid=$!
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/health" >"$work/health.json" 2>/dev/null; then
    log "restored copy answers /health: $(cat "$work/health.json")"
    log "verify-restore: OK"
    exit 0
  fi
  sleep 1
done
tail -n 20 "$work/server.log" >&2
die "the restored copy did not start"
