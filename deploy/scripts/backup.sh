#!/usr/bin/env bash
# Encrypted backup of the live database.
#   1. consistent snapshot (SQLite VACUUM INTO, the server keeps running)
#   2. integrity check of the snapshot (refuses to store a broken backup)
#   3. encryption with age to the public key(s) in AGE_RECIPIENTS_FILE
#   4. upload to Oracle Object Storage (when OCI_BUCKET is set)
#   5. keeps the newest KEEP backups, locally and in the bucket
# The plain snapshot exists only in a private temporary folder and is removed on exit.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
source "$here/lib.sh"

: "${BACKUP_DIR:?BACKUP_DIR is not set}"
: "${AGE_RECIPIENTS_FILE:?AGE_RECIPIENTS_FILE is not set}"
: "${KEEP:=30}"
[[ -s "$AGE_RECIPIENTS_FILE" ]] || die "no age recipients in $AGE_RECIPIENTS_FILE"
command -v age >/dev/null || die "age is not installed"

on_error() {
  local code=$?
  log "backup failed (exit $code)"
  alert "הגיבוי נכשל" "הגיבוי האוטומטי של מסד הנתונים נכשל בשרת $(hostname) בשעה $(date '+%H:%M'). יש לבדוק: journalctl -u tuition-backup"
  exit "$code"
}
trap on_error ERR

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$BACKUP_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
name="tuition-$ts.db.age"

log "snapshot"
ops snapshot --out "$work/tuition.db" >/dev/null
log "integrity check"
ops verify --db "$work/tuition.db" >"$work/verify.json"

log "encrypt"
age --encrypt -R "$AGE_RECIPIENTS_FILE" -o "$BACKUP_DIR/$name.part" "$work/tuition.db"
mv "$BACKUP_DIR/$name.part" "$BACKUP_DIR/$name"
(cd "$BACKUP_DIR" && sha256sum "$name" >"$name.sha256")

if [[ -n "${OCI_BUCKET:-}" ]]; then
  log "upload to bucket $OCI_BUCKET"
  for f in "$name" "$name.sha256"; do
    # shellcheck disable=SC2046
    oci os object put $(oci_args) --bucket-name "$OCI_BUCKET" --name "${OCI_PREFIX:-}$f" \
      --file "$BACKUP_DIR/$f" --force >/dev/null
  done
fi

log "retention: keep $KEEP"
mapfile -t old < <(find "$BACKUP_DIR" -maxdepth 1 -name 'tuition-*.db.age' -printf '%f\n' | sort -r | tail -n +"$((KEEP + 1))")
for f in "${old[@]}"; do rm -f "$BACKUP_DIR/$f" "$BACKUP_DIR/$f.sha256"; done
if [[ -n "${OCI_BUCKET:-}" ]]; then
  # shellcheck disable=SC2046
  mapfile -t remote < <(oci os object list $(oci_args) --bucket-name "$OCI_BUCKET" --prefix "${OCI_PREFIX:-}tuition-" \
    --all --query 'data[].name' --raw-output | tr -d '[]", ' | grep '\.db\.age$' | sort -r | tail -n +"$((KEEP + 1))")
  for f in "${remote[@]}"; do
    # shellcheck disable=SC2046
    oci os object delete $(oci_args) --bucket-name "$OCI_BUCKET" --object-name "$f" --force >/dev/null
    # shellcheck disable=SC2046
    oci os object delete $(oci_args) --bucket-name "$OCI_BUCKET" --object-name "$f.sha256" --force >/dev/null || true
  done
fi

log "done: $name"
echo "$BACKUP_DIR/$name"
