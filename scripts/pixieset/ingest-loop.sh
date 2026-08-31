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

  # The ingest prints "nothing is verified and waiting to ingest." — which
  # matched NONE of the original alternatives ("nothing to ingest" needs those
  # two words adjacent). The guard therefore never fired: 3,013 passes, 0
  # idles, respawning tsx every ~4s for 34h until 2026-08-18. Keep the old
  # spellings for safety and match the real one.
  if echo "$out" | grep -qiE "nothing (is verified|to ingest)|no verified|no collection"; then
    if [ "$FOREVER" -eq 1 ]; then
      echo "--- nothing staged; idling ${IDLE_SLEEP}s · $(date '+%H:%M:%S') ---"
      sleep "$IDLE_SLEEP"
      continue
    fi
    echo "=== drained: no verified collections left · $(date '+%H:%M:%S') ==="
    break
  fi

  # RELEASING AN ARCHIVE DOES NOT FREE THE SPACE. Time Machine's hourly local
  # APFS snapshots pin the deleted blocks, so `df` does not move and the pipeline
  # creeps toward its 60 GB floor while appearing to clean up after itself.
  # Measured 2026-08-30: thinning took 86 GB -> 103 GB with 24 snapshots cleared.
  #
  # This thins LOCAL snapshots only. The external Time Machine backups are
  # untouched — those are the real safety net for the things not in GitHub or R2
  # (.env.local, keychain, staging mid-migration), and they stay.
  #
  # Only runs when headroom is actually tight, so a healthy disk is left alone
  # and Mason keeps his recent local restore points.
  free_gb=$(df -g / | awk 'NR==2{print $4}')
  floor=${PIXIESET_MIN_FREE_GB:-60}
  if [ "${free_gb:-999}" -lt $((floor + 40)) ]; then
    echo "--- ${free_gb}GB free (floor ${floor}) — thinning local TM snapshots ---"
    tmutil thinlocalsnapshots / 53687091200 4 >/dev/null 2>&1
    echo "--- after thinning: $(df -g / | awk 'NR==2{print $4}')GB free ---"
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
    # Output matched neither "nothing staged" nor an ingest result. A guard
    # that keys on wording fails OPEN when the wording drifts, and failing
    # open here means a tight respawn loop. Fail CLOSED instead: idle, and say
    # so loudly, so the next drift costs 5 minutes of latency and not 34 hours
    # of pinned CPU. A real ingest always prints "archive KEPT"/"N failed", so
    # this branch cannot slow a draining queue.
    consecutive=0
    if [ "$FOREVER" -eq 1 ]; then
      echo "--- UNRECOGNIZED ingest output; idling ${IDLE_SLEEP}s (output above) ---"
      sleep "$IDLE_SLEEP"
      continue
    fi
  fi
done

echo "=== ingest loop finished · $(date '+%H:%M:%S') ==="
df -h / | tail -1
