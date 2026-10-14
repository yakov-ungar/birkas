#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 VM (docs/DEPLOY.md, step 3). Run as root.
# Installs Node 22, Nginx, certbot, age and the OCI CLI; creates the service user, folders and
# 2 GB of swap; installs the systemd units. It does not touch the firewall (see firewall.sh).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

apt-get update
apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx age unattended-upgrades

# Node.js 22 LTS from NodeSource.
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update && apt-get install -y nodejs
fi

# 2 GB swap for the 1 GB machine.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

id tuition >/dev/null 2>&1 || useradd --system --home-dir /var/lib/tuition --shell /usr/sbin/nologin tuition
install -d -o tuition -g tuition -m 0700 /var/lib/tuition /var/backups/tuition
install -d -o root -g tuition -m 0750 /etc/tuition
install -d -m 0755 /opt/tuition/releases /var/www/certbot

for f in tuition.env backup.env; do
  [[ -e /etc/tuition/$f ]] || install -o root -g tuition -m 0640 "$src/$f.example" "/etc/tuition/$f"
done
install -m 0644 "$src"/systemd/*.service "$src"/systemd/*.timer /etc/systemd/system/
install -d /etc/systemd/journald.conf.d && install -m 0644 "$src/journald/tuition.conf" /etc/systemd/journald.conf.d/
install -m 0644 "$src/nginx/tuition-proxy.conf" /etc/nginx/snippets/
[[ -e /etc/nginx/sites-available/tuition.conf ]] || install -m 0644 "$src/nginx/tuition.conf" /etc/nginx/sites-available/
systemctl daemon-reload
systemctl restart systemd-journald
systemctl enable tuition.service tuition-backup.timer tuition-health.timer

echo "Next: edit /etc/tuition/tuition.env and backup.env, then follow docs/DEPLOY.md step 5."
