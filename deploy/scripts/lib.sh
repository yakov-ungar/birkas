#!/usr/bin/env bash
# Shared helpers for the operation scripts. Sourced, not run.
set -euo pipefail
umask 077

: "${APP_DIR:=/opt/tuition/current}"
: "${APP_ENV_FILE:=/etc/tuition/tuition.env}"
: "${NODE_BIN:=$(command -v node)}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Runs the ops CLI of the installed release with the server's configuration.
ops() { "$NODE_BIN" --env-file="$APP_ENV_FILE" "$APP_DIR/dist/cli/ops.js" "$@"; }

# Email to ALERT_EMAIL (or the admins). Never fails the caller.
alert() {
  ops alert --subject "$1" --text "$2" >/dev/null 2>&1 || log "alert could not be sent: $1"
}

oci_args() {
  if [[ "${OCI_AUTH:-}" == "instance_principal" ]]; then echo "--auth instance_principal"; fi
}
