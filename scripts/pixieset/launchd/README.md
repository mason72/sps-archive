# The migration runs as two launchd agents

Set up 2026-08-16, after the pipeline stopped **three times in one day** and each
time it was Mason who noticed, not the tooling:

1. the ingest loop lived inside a session's shell, so it died with the session;
2. a partial ingest (9 transient upload errors out of 322 photos) halted the
   whole 1,342-collection queue;
3. the Mac rebooted and took every process — and the logs, which were in `/tmp`.

A multi-week migration cannot depend on someone remembering to restart it.

| Agent | What it does | Log |
|---|---|---|
| `com.twodudes.pixieset.watch` | proves downloaded ZIPs, stages them | `~/pixieset-staging/logs/watch.log` |
| `com.twodudes.pixieset.ingest` | staged archive → Pixeltrunk event | `~/pixieset-staging/logs/ingest.log` |

Both are `RunAtLoad` + `KeepAlive`, so they start at login and come back if they
die. **Verified by killing each and watching launchd respawn it with a new PID** —
an untested restart policy is a belief, not a guarantee.

## Install (or reinstall, on a fresh machine)

```bash
cp scripts/pixieset/launchd/*.plist ~/Library/LaunchAgents/
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.twodudes.pixieset.watch.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.twodudes.pixieset.ingest.plist
```

The plists hard-code `/Users/masonfoster/Projects/SPS/sps-archive` as the working
directory and the log paths under `/Users/masonfoster`. On any other machine or
username those must be edited first — see `~/.claude/rules/machine-portability.md`
for why a baked-in path is the thing that silently orphans a scheduled job.

## Check / stop / start

```bash
launchctl list | grep pixieset
launchctl print "gui/$(id -u)/com.twodudes.pixieset.ingest"
launchctl kickstart -k "gui/$(id -u)/com.twodudes.pixieset.ingest"
launchctl bootout "gui/$(id -u)/com.twodudes.pixieset.ingest"
```

`launchctl list` shows PID and last exit status. A PID means running; a `-` with
a non-zero status means it exited and is being throttled.

## Three things that will bite

**launchd's PATH has no Homebrew.** `node` and `npx` live in `/opt/homebrew/bin`,
which is absent from the default agent environment, so every pass would fail —
silently, since nothing reads an agent's exit code. Both plists set `PATH`
explicitly and `ingest-loop.sh` exports it again. Belt and braces on purpose.

**A script that EXITS under `KeepAlive` gets relaunched instantly and spins.**
That is why the agent runs `ingest-loop.sh --forever`, which idles for
`PIXIESET_IDLE_SLEEP` (default 300s) when nothing is staged instead of exiting.
Run the script with no argument for a one-shot drain by hand.

**Logs must not live in `/tmp`.** macOS clears it on boot; the 2026-08-16 reboot
erased the only record of ten hours of work. They now go to
`~/pixieset-staging/logs/`, which is outside `~/Projects` and therefore outside
Syncthing — the same reason staging lives there.

## Only ONE machine should run these

Set up on **Masons-Mac-mini**. `~/Projects` is Syncthing-replicated to the work
laptop, so the scripts exist on both, but the queue file is a single shared
record and two ingests racing it would fight over the same collections. Do not
bootstrap these agents on the laptop.
