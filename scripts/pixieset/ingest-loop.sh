#!/bin/bash
# Drain every `verified` collection into Pixeltrunk, oldest first.
#
#   bash scripts/pixieset/ingest-loop.sh              drain what's ready, then exit
#   bash scripts/pixieset/ingest-loop.sh --forever    never exit; idle when drained
#
# `--forever` is what the launchd agent runs (com.twodudes.pixieset.ingest).
# It matters: a script that EXITS when the queue is empty, under a KeepAlive
# agent, gets relaunched instantly and spins. Idling inside the script is the
# difference between a service and a busy-loop.
#
# Learned 2026-08-15/16, three stoppages in one day, each found only because
# Mason asked:
#   * a `for` loop written inline in a background tool call is a child of that
#     session's shell, so it dies with the session — the loop must BE the
#     detached process, not live inside one;
#   * halting the whole queue on a partial ingest stopped 1,342 collections over
#     9 transient upload errors;
#   * a reboot took everything, and the logs with it (they were in /tmp).
# Hence: launchd owns it, logs live in ~/pixieset-staging/logs/, and a partial
# ingest retries rather than stopping.
#
# Each pass ingests exactly one collection and releases its archive only after
# the ingest's own verification passes, so an interrupted run costs at most one
# collection's work and never a staged archive. Safe to kill and restart at any
# moment: the ingest is idempotent by (event, original_filename).
set -u
cd "$(dirname "$0")/../.." || exit 1

# launchd starts agents with a minimal PATH that does NOT include Homebrew, so
# `npx` would not resolve and the agent would fail on every pass — silently,
# since nothing reads an agent's exit code. Belt and braces with the plist.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

FOREVER=0
IDLE_SLEEP=${PIXIESET_IDLE_SLEEP:-300}
[ "${1:-}" = "--forever" ] && FOREVER=1

consecutive=0
pass=0

while :; do
  pass=$((pass + 1))
  echo "=== pass $pass · $(date '+%Y-%m-%d %H:%M:%S') ==="
  out=$(npx tsx scripts/pixieset-ingest.ts --next --apply 2>&1)
  # Inngest settlement cannot fire from this machine (no event key); production's
  # nightly ai-index sweep picks these events up. Not worth a stack trace a pass.
  echo "$out" | grep -vE "^\s+at |Inngest API Error|settlement dispatch"

  if echo "$out" | grep -qiE "nothing to ingest|no verified|no collection"; then
    if [ "$FOREVER" -eq 1 ]; then
      echo "--- nothing staged; idling ${IDLE_SLEEP}s · $(date '+%H:%M:%S') ---"
      sleep "$IDLE_SLEEP"
      continue
    fi
    echo "=== drained: no verified collections left · $(date '+%H:%M:%S') ==="
    break
  fi

  # A partial ingest is NORMAL, not fatal. R2 uploads fail transiently (TLS
  # "bad record mac" ran at ~3% on 2026-08-16 and cleared entirely on retry).
  # The ingest already does the safe thing — keeps the archive, leaves the
  # collection `verified` — so the next pass retries the SAME collection and
  # fills only the gaps. Give up only if a collection cannot progress at all.
  if echo "$out" | grep -qiE "archive KEPT|[0-9]+ failed"; then
    if echo "$out" | grep -qE " 0 failed"; then
      consecutive=0
    else
      consecutive=$((consecutive + 1))
      echo "--- partial ingest (consecutive failures: $consecutive/3) ---"
      if [ "$consecutive" -ge 3 ]; then
        echo "=== stuck: 3 passes could not complete · $(date '+%H:%M:%S') ==="
        if [ "$FOREVER" -eq 1 ]; then
          # Do not die — a stuck collection must not take the service down with
          # it. Back off long enough for a network problem to clear, then retry.
          echo "--- backing off ${IDLE_SLEEP}s before trying again ---"
          consecutive=0
          sleep "$IDLE_SLEEP"
          continue
        fi
        break
      fi
      sleep 20
      continue
    fi
  else
    consecutive=0
  fi
done

echo "=== ingest loop finished · $(date '+%H:%M:%S') ==="
df -h / | tail -1
