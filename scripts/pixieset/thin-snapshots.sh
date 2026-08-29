#!/bin/bash
# Reclaim the disk that Time Machine's hourly LOCAL snapshots pin.
#
# WHY THIS EXISTS. Releasing an ingested archive does not return its blocks:
# macOS takes an APFS local snapshot every hour, and each one pins every file
# deleted since the previous snapshot for ~24h. So the staging volume trends
# DOWN even when the ingest is draining perfectly. Measured 2026-08-29: free
# space fell 92 -> 75 GB overnight in a clean monotonic line while 14 hourly
# snapshots accumulated; thinning returned 20 GB in seconds.
#
# This matters more, not less, now that the downloader is bounded by a disk
# floor: the floor is read from `df`, and `df` counts snapshot-pinned blocks as
# USED. So without thinning the downloader throttles itself against space that
# is already free in every sense except the bookkeeping.
#
# SAFETY. `tmutil thinlocalsnapshots` touches LOCAL snapshots only. Time Machine
# backups on the external destination are not involved and are not modified.
# Local snapshots regenerate hourly, so this is not a durable deletion of
# anything; the cost of thinning is losing local "browse back a few hours",
# never a real backup.
#
# Fails CLOSED and LOUD: if thinning cannot get the volume above the floor, it
# says so and exits non-zero rather than reporting success, because a silent
# "did nothing" here reads exactly like "there was nothing to do".
set -u

STAGING="${PIXIESET_STAGING:-$HOME/pixieset-staging}"
FLOOR_GB="${PIXIESET_MIN_FREE_GB:-60}"
# Thin only when we are within this much of the floor; otherwise do nothing, so
# the machine keeps its normal snapshot history on ordinary days.
MARGIN_GB="${PIXIESET_THIN_MARGIN_GB:-25}"
WANT_BYTES=$((21474836480))   # ask for 20 GB
LOG="$STAGING/logs/thin-snapshots.log"

mkdir -p "$(dirname "$LOG")"
free_gb() { df -g "$STAGING" | tail -1 | awk '{print $4}'; }

before=$(free_gb)
trigger=$((FLOOR_GB + MARGIN_GB))

if [ "$before" -gt "$trigger" ]; then
  echo "$(date '+%F %T') ok — ${before} GB free, above the ${trigger} GB trigger (floor ${FLOOR_GB} + margin ${MARGIN_GB}). Nothing thinned." >> "$LOG"
  exit 0
fi

count=$(tmutil listlocalsnapshots / 2>/dev/null | grep -c 'com.apple')
echo "$(date '+%F %T') ${before} GB free is within ${MARGIN_GB} GB of the ${FLOOR_GB} GB floor — thinning ${count} local snapshot(s)" >> "$LOG"

tmutil thinlocalsnapshots / "$WANT_BYTES" 4 >> "$LOG" 2>&1
sleep 3
after=$(free_gb)
echo "$(date '+%F %T') reclaimed $((after - before)) GB — now ${after} GB free, $(tmutil listlocalsnapshots / 2>/dev/null | grep -c 'com.apple') snapshot(s) left" >> "$LOG"

if [ "$after" -le "$FLOOR_GB" ]; then
  echo "$(date '+%F %T') ✗ STILL BELOW FLOOR — ${after} GB free against a ${FLOOR_GB} GB floor. Snapshots were not the (only) problem: the ingest is behind, or something else is consuming the volume. The downloader will correctly refuse to request more until this clears." >> "$LOG"
  exit 1
fi
exit 0
