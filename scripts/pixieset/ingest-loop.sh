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

  # ---- HOUSEKEEPING — runs EVERY pass, before any branch can `continue` ----
  #
  # This block used to live AFTER a successful ingest. That is what killed the
  # machine on 2026-09-02: the disk hit 0 bytes, so nothing could ingest, so the
  # loop took the "nothing staged" branch and `continue`d — skipping the only
  # code that frees space. Low disk stopped the one thing that fixes low disk.
  # The 60 GB floor did fire; it just governs DOWNLOADS, and downloads were not
  # what was still consuming the volume.
  #
  # INVARIANT: anything that reclaims space must run on a pass that does no
  # work, or it cannot recover from the state where no work is possible.
  free_gb=$(df -g / | awk 'NR==2{print $4}')
  floor=${PIXIESET_MIN_FREE_GB:-60}
  if [ "${free_gb:-999}" -lt $((floor + 40)) ]; then
    echo "--- ${free_gb}GB free (floor ${floor}) — housekeeping ---"

    # (a) Release archives whose photos are provably in Pixeltrunk. An ingest
    #     that crashes between markIngested() and the unlink strands its bytes
    #     forever, because `--next` then skips that collection. 19 collections /
    #     106 GB had accumulated this way. The sweep verifies per FILE against
    #     the database and never deletes anything it cannot prove landed.
    npx tsx scripts/pixieset/release-sweep.ts --apply 2>&1 | sed 's/^/    /'

    # (b) Then thin local APFS snapshots. Order matters: a snapshot pins blocks
    #     for ~24h, so deleting files first and thinning second is what actually
    #     returns them. External Time Machine backups are untouched.
    tmutil thinlocalsnapshots / 53687091200 4 2>&1 | sed 's/^/    /'

    after=$(df -g / | awk 'NR==2{print $4}')
    echo "--- after housekeeping: ${after}GB free ---"
    # Fail LOUD. A cleanup step whose failure is invisible is how a disk fills up
    # while the script reports it is managing space.
    if [ "${after:-0}" -lt "$floor" ]; then
      echo "!!! STILL BELOW THE ${floor}GB FLOOR after housekeeping (${after}GB)."
      echo "!!! Nothing automatic can fix this — a human must look. Largest staged:"
      du -sh "$HOME/pixieset-staging/verified" 2>/dev/null | sed 's/^/    /'
    fi
  fi

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

  # A `verified` collection whose ZIPs are not staged yet is a REAL, nameable
  # state — not wording drift — and it has one cause: the watcher records the
  # state and moves the bytes as separate steps, so a sweep running alongside
  # this loop can have marked a collection `verified` while its archive is
  # still in ~/Downloads awaiting CRC. (The mini's own cross-volume EXDEV bug
  # produced the same shape.) The ingest prints "no staged ZIPs for <slug>" and
  # exits without ingesting anything.
  #
  # Left unnamed on 2026-08-31 this fell into the UNRECOGNIZED branch below and
  # span 77 passes in 45 seconds. It gets its own guard so the operator is told
  # WHICH collection is stalled and why, rather than reading a generic warning.
  # The ingest always takes the OLDEST verified collection, so it cannot skip
  # past this one — idling and retrying is the only correct move.
  if echo "$out" | grep -qiE "no staged ZIPs"; then
    consecutive=0
    if [ "$FOREVER" -eq 1 ]; then
      echo "--- oldest verified collection has no staged archive yet; idling ${IDLE_SLEEP}s ---"
      sleep "$IDLE_SLEEP"
      continue
    fi
    echo "=== stopping: oldest verified collection has no staged archive."
    echo "===   Is a watcher sweep still running? Let it finish, then re-run. ==="
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
    # Output matched neither "nothing staged" nor an ingest result. A guard
    # that keys on wording fails OPEN when the wording drifts, and failing
    # open here means a tight respawn loop. Fail CLOSED instead: idle, and say
    # so loudly, so the next drift costs 5 minutes of latency and not 34 hours
    # of pinned CPU. A real ingest always prints "archive KEPT"/"N failed", so
    # this branch cannot slow a draining queue.
    #
    # ⚠️ PLAIN MODE MUST STOP HERE — it must not fall through to `done`.
    # Until 2026-08-31 the fail-closed idle below lived ONLY under `--forever`,
    # so a plain run that hit unrecognized output dropped out of this `if` with
    # no sleep and no break and respawned `npx tsx` as fast as it could exit:
    # 77 passes in 45 seconds. That is the 2026-08-18 busy loop returning
    # through a different door, which is the whole lesson — fixing one instance
    # of a failure mode does not retire the failure mode. The invariant, written
    # as code rather than as a comment: EVERY branch of this loop either sleeps
    # or breaks. There is no path that reaches `done` immediately.
    consecutive=0
    if [ "$FOREVER" -eq 1 ]; then
      echo "--- UNRECOGNIZED ingest output; idling ${IDLE_SLEEP}s (output above) ---"
      sleep "$IDLE_SLEEP"
      continue
    fi
    echo "=== stopping: UNRECOGNIZED ingest output (above) · $(date '+%H:%M:%S') ==="
    break
  fi
done

echo "=== ingest loop finished · $(date '+%H:%M:%S') ==="
df -h / | tail -1
