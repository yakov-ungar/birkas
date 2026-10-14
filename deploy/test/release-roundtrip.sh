#!/usr/bin/env bash
# End-to-end check of the release archive and the backup scripts, on this machine only
# (no server, no cloud): package → run the release outside the repository → back up three times
# (retention) → restore into a second copy and check it → a damaged backup is refused.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
t="$(mktemp -d)"
pids=()
# shellcheck disable=SC2329 # called by the trap
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$t"; }
trap cleanup EXIT
step() { printf '\n== %s\n' "$*"; }

step "package"
version="${VERSION:-roundtrip}"
archive="$(VERSION="$version" "$root/deploy/scripts/package.sh" | tail -n 1)"
tar -C "$t" -xzf "$archive"
app="$t/tuition-$version"
[[ -f "$app/dist/main.js" && -f "$app/web/index.html" && -x "$app/deploy/scripts/backup.sh" ]]
[[ ! -e "$app/src" && ! -e "$app/test" ]] || { echo "sources leaked into the release"; exit 1; }

step "configure (production mode, local mail outbox)"
mkdir -p "$t/data" "$t/backups"
cat >"$t/tuition.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3911
DATABASE_URL=file:$t/data/tuition.db
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
APP_BASE_URL=https://school.example
TRUST_PROXY=true
WEB_DIST=$app/web
MAIL_TRANSPORT=outbox
SCHEDULER_ENABLED=false
LOG_LEVEL=warn
ENV
age-keygen -o "$t/identity.txt" 2>/dev/null
age-keygen -y "$t/identity.txt" >"$t/recipients.txt"

step "migrate and create the first admin from the release"
(cd "$t" && DATABASE_URL="file:$t/data/tuition.db" \
  "$app/node_modules/.bin/prisma" migrate deploy --schema "$app/prisma/schema.prisma" >/dev/null)
node --env-file="$t/tuition.env" "$app/dist/cli/create-admin.js" --name "מנהלת" --email admin@school.example >/dev/null

step "the release starts and serves the app"
node --env-file="$t/tuition.env" "$app/dist/main.js" >"$t/server.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:3911/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3911/health | grep -q '"status":"ok"'
curl -fsS http://127.0.0.1:3911/login | grep -q '<div id="root">'
asset="$(curl -fsS http://127.0.0.1:3911/login | grep -o '/assets/[^"]*\.js' | head -n 1)"
curl -fsSI "http://127.0.0.1:3911$asset" | grep -qi '^cache-control: public, max-age=31536000, immutable'
curl -fsSI http://127.0.0.1:3911/health | grep -qi '^strict-transport-security:'
[[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3911/api/test/outbox)" == 404 ]]

export APP_DIR="$app" APP_ENV_FILE="$t/tuition.env" BACKUP_DIR="$t/backups" \
  AGE_RECIPIENTS_FILE="$t/recipients.txt" KEEP=2 OCI_BUCKET=
step "three backups while the server runs; retention keeps 2"
for _ in 1 2 3; do "$app/deploy/scripts/backup.sh" >/dev/null; sleep 1; done
[[ "$(find "$t/backups" -name '*.db.age' | wc -l)" == 2 ]]
latest="$(find "$t/backups" -name '*.db.age' | sort | tail -n 1)"
if grep -q "SQLite format" "$latest"; then echo "backup is not encrypted"; exit 1; fi

step "restore into a second copy and check it"
VERIFY_PORT=3912 "$app/deploy/scripts/verify-restore.sh" "$latest" "$t/identity.txt" >"$t/verify.out"
grep -q '"ok": true' "$t/verify.out"
grep -q '"auditRows": 1' "$t/verify.out"

step "a damaged backup and a wrong key are refused"
cp "$latest" "$t/damaged.db.age"
printf 'x' | dd of="$t/damaged.db.age" bs=1 seek=200 conv=notrunc 2>/dev/null
if "$app/deploy/scripts/verify-restore.sh" "$t/damaged.db.age" "$t/identity.txt" >/dev/null 2>&1; then
  echo "a damaged backup was accepted"; exit 1
fi
age-keygen -o "$t/other.txt" 2>/dev/null
if "$app/deploy/scripts/verify-restore.sh" "$latest" "$t/other.txt" >/dev/null 2>&1; then
  echo "a backup opened with the wrong key"; exit 1
fi

printf '\nrelease round trip: OK\n'
