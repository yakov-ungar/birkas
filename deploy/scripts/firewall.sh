#!/usr/bin/env bash
# Host firewall: only SSH (from your address), HTTP and HTTPS. Run as root.
#
#   firewall.sh <your-public-ip>
#
# Oracle also filters in the VCN Security List; open the same three ports there (docs/DEPLOY.md).
# SSH is allowed first, so the current session is not cut off.
set -euo pipefail
admin_ip="${1:?usage: firewall.sh <your-public-ip>}"
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ "$admin_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$ ]] || { echo "not an IPv4 address: $admin_ip" >&2; exit 1; }

apt-get install -y ufw >/dev/null
# Oracle's Ubuntu images ship their own iptables rules that block 80/443 and fight with ufw.
if systemctl is-enabled netfilter-persistent >/dev/null 2>&1; then
  systemctl disable --now netfilter-persistent
fi
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$admin_ip" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
