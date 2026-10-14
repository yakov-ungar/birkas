#!/usr/bin/env bash
# Installs a release archive on the server. Run as root.
#
#   release.sh tuition-<version>.tar.gz
#
# Order: backup → unpack → database migrations → switch "current" → restart → health check.
# If the new version does not answer, "current" goes back to the previous release. Database
# migrations only add (they never drop data), so the previous release keeps working.
archive="${1:?usage: release.sh <tuition-version.tar.gz>}"
base="${BASE:-/opt/tuition}"
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
set -euo pipefail
umask 022

if [[ -f "$archive.sha256" ]]; then
  (cd "$(dirname "$archive")" && sha256sum --quiet -c "$(basename "$archive").sha256")
fi
name="$(basename "$archive" .tar.gz)"
[[ ! -e "$base/releases/$name" ]] || { echo "$name is already installed" >&2; exit 1; }

previous="$(readlink -f "$base/current" 2>/dev/null || true)"
if [[ -n "$previous" ]]; then
  echo "backup before upgrading"
  # The backup unit runs with its own environment file; start waits until it finishes.
  systemctl start tuition-backup.service
fi

mkdir -p "$base/releases"
tar -C "$base/releases" -xzf "$archive"
chown -R root:root "$base/releases/$name"

echo "database migrations"
systemd-run --quiet --wait --pipe --collect --uid=tuition --gid=tuition \
  -p EnvironmentFile=/etc/tuition/tuition.env -p ReadWritePaths=/var/lib/tuition \
  "$base/releases/$name/node_modules/.bin/prisma" migrate deploy --schema "$base/releases/$name/prisma/schema.prisma"

ln -sfn "$base/releases/$name" "$base/current"
systemctl restart tuition

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "running $name"
    exit 0
  fi
  sleep 1
done

echo "the new release did not answer /health" >&2
if [[ -n "$previous" ]]; then
  ln -sfn "$previous" "$base/current"
  systemctl restart tuition
  echo "rolled back to $(basename "$previous")" >&2
fi
exit 1
