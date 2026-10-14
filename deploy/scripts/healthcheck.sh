#!/usr/bin/env bash
# Run every 5 minutes by tuition-health.timer. Emails once when the server stops answering,
# and once more when it is back (no flood of alerts).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
source "$here/lib.sh"

url="${HEALTH_URL:-http://127.0.0.1:3000/health}"
state="${HEALTH_STATE:-/var/lib/tuition/health.state}"
prev="$(cat "$state" 2>/dev/null || echo ok)"

if curl -fsS --max-time 10 "$url" | grep -q '"status":"ok"'; then
  if [[ "$prev" != "ok" ]]; then
    alert "השרת חזר לפעול" "השרת $(hostname) עונה שוב לבדיקת התקינות."
  fi
  echo ok >"$state"
else
  # Two failures in a row before alerting (a restart takes a few seconds).
  case "$prev" in
    ok) echo fail1 >"$state" ;;
    fail1)
      alert "השרת לא מגיב" "בדיקת התקינות של $(hostname) נכשלה פעמיים ברציפות. יש לבדוק: systemctl status tuition"
      echo down >"$state"
      ;;
    *) echo down >"$state" ;;
  esac
  exit 1
fi
