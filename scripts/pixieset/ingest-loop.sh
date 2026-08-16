#!/bin/bash
# Drain every `verified` collection into Pixeltrunk, oldest first.
#
# Run it DETACHED, so it outlives the shell that started it:
#
#   nohup bash scripts/pixieset/ingest-loop.sh >> /tmp/px-ingest.log 2>&1 &
#
# Learned 2026-08-15: a `for` loop written inline in a background tool call is a
# child of that session's shell, so it dies with the session. The watcher
# survived the same restart because `nohup node … &` forked a real detached
# child. The loop has to BE the nohup'd process, not live inside one.
#
# Each pass ingests exactly one collection and releases its archive only after
# the ingest's own verification passes, so an interrupted run costs at most one
# collection's work and never a staged archive. Safe to kill and restart: the
# ingest is idempotent by (event, original_filename).
set -u
cd "$(dirname "$0")/../.." || exit 1

MAX=${1:-200}
for i in $(seq 1 "$MAX"); do
  echo "=== pass $i · $(date '+%H:%M:%S') ==="
  out=$(npx tsx scripts/pixieset-ingest.ts --next --apply 2>&1)
  # Inngest settlement can't fire from a laptop (no event key); production's
  # nightly ai-index sweep picks these up. Not worth a stack trace per pass.
  echo "$out" | grep -vE "^\s+at |Inngest API Error|settlement dispatch"

  if echo "$out" | grep -qiE "nothing to ingest|no verified|no collection"; then
    echo "=== drained: no verified collections left · $(date '+%H:%M:%S') ==="
    break
  fi
  if echo "$out" | grep -qiE "^Error|FATAL"; then
    echo "=== stopping on error · $(date '+%H:%M:%S') ==="
    break
  fi
done
echo "=== ingest loop finished · $(date '+%H:%M:%S') ==="
df -h / | tail -1
