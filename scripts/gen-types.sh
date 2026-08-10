#!/usr/bin/env bash
#
# Regenerate src/lib/supabase/database.types.ts from the live Supabase schema.
#
# Never bare-redirects the generator over the tracked file: `supabase gen types`
# exits 0 at the npm layer even when auth fails, and the shell redirect happily
# replaces the whole file with a one-line JSON error (lessons.md #44). Generate
# to a temp path, sanity-check it, then move into place.
#
set -euo pipefail

PROJECT_ID="${SUPABASE_PROJECT_ID:-hfusdrtrizabzzcdhnyy}"
DEST="src/lib/supabase/database.types.ts"
MIN_LINES=800
# Symbols that must survive any regeneration; if one is missing, the output is
# an error page or a schema we do not recognise, and must not be moved.
REQUIRED=(events images subscriptions user_id search_images_by_embedding)

# The CLI authenticates from the environment, never from argv (secrets-handling).
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  if token=$(security find-generic-password -s supabase-access-token -w 2>/dev/null); then
    SUPABASE_ACCESS_TOKEN="$token"
    export SUPABASE_ACCESS_TOKEN
    unset token
  else
    echo "gen-types: no SUPABASE_ACCESS_TOKEN in env and no 'supabase-access-token' in the keychain." >&2
    exit 1
  fi
fi

TMP=$(mktemp -t database.types)
trap 'rm -f "$TMP"' EXIT

npx supabase gen types typescript --project-id "$PROJECT_ID" > "$TMP"

lines=$(wc -l < "$TMP" | tr -d ' ')
if (( lines < MIN_LINES )); then
  echo "gen-types: refusing to install $lines lines (expected >= $MIN_LINES). Output was:" >&2
  head -5 "$TMP" >&2
  exit 1
fi

for sym in "${REQUIRED[@]}"; do
  if ! grep -q "$sym" "$TMP"; then
    echo "gen-types: refusing to install — required symbol '$sym' missing from output." >&2
    exit 1
  fi
done

mv "$TMP" "$DEST"
trap - EXIT
echo "gen-types: wrote $DEST ($lines lines)."
