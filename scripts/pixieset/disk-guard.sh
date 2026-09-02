#!/bin/bash
# Warn about the staging disk BEFORE it becomes unrecoverable — in pure shell.
#
# WHY PURE SHELL. On 2026-09-02 the mini reached 0 bytes free. The hourly
# watchdog that exists to email when the migration loses its pulse
# (stall-check.ts) is launched as `npx tsx …`, and npm needs to write to
# ~/.npm/_cacache — so it died with ENOSPC every hour and sent nothing:
#
#   npm error nospc There appears to be insufficient space on your system
#
# The monitor shared fate with the thing it monitors, and a silent watchdog is
# indistinguishable from a healthy system. Mason found out by noticing his
# machine was broken. This script therefore uses NOTHING that needs the disk:
# no node, no npx, no tsx, no temp files — df, awk, and curl only.
#
# INVARIANT: a check for condition X must not depend on X being false.
#
#   bash scripts/pixieset/disk-guard.sh          # warn if low
#   PIXIESET_WARN_GB=120 bash …/disk-guard.sh    # custom threshold
set -u
cd "$(dirname "$0")/../.." || exit 1

WARN_GB=${PIXIESET_WARN_GB:-75}           # above the 60 GB floor on purpose: warn while there is still room to act
THROTTLE_H=${PIXIESET_WARN_THROTTLE_H:-6} # a low disk stays low for hours; hourly mail about it is how alerts get ignored
free_gb=$(df -g / | awk 'NR==2{print $4}')
[ -z "${free_gb:-}" ] && { echo "disk-guard: could not read df — treating as CRITICAL"; free_gb=0; }

echo "disk-guard: ${free_gb}GB free (warn below ${WARN_GB}GB)"
[ "$free_gb" -ge "$WARN_GB" ] && exit 0

# Throttle repeats, but FAIL OPEN: if the marker cannot be read or written
# (which is exactly what happens on a full disk) the mail still goes out.
MARKER="$HOME/pixieset-staging/logs/.disk-guard-last"
now=$(date +%s)
last=$(cat "$MARKER" 2>/dev/null || echo 0)
case "$last" in (*[!0-9]*|"") last=0 ;; esac
if [ "$last" -gt 0 ] && [ $((now - last)) -lt $((THROTTLE_H * 3600)) ]; then
  echo "disk-guard: ${free_gb}GB free — already alerted $(( (now-last)/3600 ))h ago, throttled"
  exit 0
fi
echo "$now" > "$MARKER" 2>/dev/null || true

staged=$(du -sh "$HOME/pixieset-staging/verified" 2>/dev/null | awk '{print $1}')
subject="[Pixeltrunk] staging disk low: ${free_gb}GB free on masons-mac-mini"
body="Free space on the mini is ${free_gb}GB (warning threshold ${WARN_GB}GB, hard floor 60GB).

Staged Pixieset archives: ${staged:-unknown}

The ingest loop runs housekeeping every pass — it releases archives whose photos
are provably in Pixeltrunk, then thins local APFS snapshots. If this email keeps
arriving, that automatic cleanup is not keeping up and something needs a look:

  ssh masonfoster@masons-mac-mini
  npx tsx scripts/pixieset/release-sweep.ts          # what could be released
  tail -40 ~/pixieset-staging/logs/ingest.log        # look for 'STILL BELOW'

At 0 bytes free nothing on the machine works, including the tooling used to fix
it — that is what happened on 2026-09-02. Act on this while there is headroom."

# Credentials come from .env.local via the ENVIRONMENT, never argv (secrets-handling.md).
# Parsed rather than sourced: .env.local carries a multi-line value that breaks `set -a; . file`.
RESEND_API_KEY=$(grep -m1 '^RESEND_API_KEY=' .env.local 2>/dev/null | cut -d= -f2-)
RESEND_FROM_EMAIL=$(grep -m1 '^RESEND_FROM_EMAIL=' .env.local 2>/dev/null | cut -d= -f2-)
ADMIN_EMAILS=$(grep -m1 '^ADMIN_EMAILS=' .env.local 2>/dev/null | cut -d= -f2-)
export RESEND_API_KEY

if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${RESEND_FROM_EMAIL:-}" ] || [ -z "${ADMIN_EMAILS:-}" ]; then
  # A missing credential is an outage of the alerting, not a reason to be quiet.
  echo "disk-guard: CANNOT SEND (key=$([ -n "${RESEND_API_KEY:-}" ] && echo yes || echo no) from=${RESEND_FROM_EMAIL:-none} to=${ADMIN_EMAILS:-none}) — ${free_gb}GB free"
  exit 1
fi

to_json=$(printf '%s' "$ADMIN_EMAILS" | awk -F, '{for(i=1;i<=NF;i++){gsub(/^ +| +$/,"",$i); printf "%s\"%s\"", (i>1?",":""), $i}}')
payload=$(BODY="$body" SUBJ="$subject" FROM="$RESEND_FROM_EMAIL" TO="$to_json" python3 <<'PYEOF'
import json, os
print(json.dumps({
    "from": "Pixeltrunk Migration <" + os.environ["FROM"] + ">",
    "to": json.loads("[" + os.environ["TO"] + "]"),
    "subject": os.environ["SUBJ"],
    "text": os.environ["BODY"],
}))
PYEOF
)

# -K - keeps the bearer token out of argv, where ps and EDR would capture it.
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST https://api.resend.com/emails \
  -H 'Content-Type: application/json' -d "$payload" -K - <<EOF
header = "Authorization: Bearer ${RESEND_API_KEY}"
EOF
)
if [ "$code" = "200" ]; then echo "disk-guard: emailed — ${free_gb}GB free"; else
  echo "disk-guard: resend failed HTTP ${code} — ${free_gb}GB free"; exit 1; fi
