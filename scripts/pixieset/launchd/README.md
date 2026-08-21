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
| `com.twodudes.pixieset.stallcheck` | hourly pulse check, emails when wrong | `~/pixieset-staging/logs/stall-check.log` |

The watcher and ingest are `RunAtLoad` + `KeepAlive`, so they start at login and come back if they
die. **Verified by killing each and watching launchd respawn it with a new PID** —
an untested restart policy is a belief, not a guarantee.

## The stall check

Added 2026-08-21, because on 2026-08-17 the pipeline quietly ran dry and nobody
noticed for **four days**. Nothing was broken: the agents were up, the ingest
idled correctly, the archive was healthy. It simply had no work and no surface
said so. That silence is the failure this closes.

`scripts/pixieset/stall-check.ts` runs hourly and emails via Resend only when
something is wrong — on a change of verdict, or once a day while it stays wrong.
Four verdicts, because they need different reactions:

| Verdict | Means | Who fixes it |
|---|---|---|
| `BROKEN` | a launchd agent is not running | restart it |
| `SPINNING` | far more passes per hour than work allows | a guard has failed open |
| `STUCK` | collections staged, oldest waiting > 4h, nothing completing | the ingest |
| `STARVED` | nothing staged, work queued, nothing done in > 36h | **Mason** — run the downloader |

`STARVED` is the four-day case, and it is deliberately not called an error: the
download half needs Chrome pointed at Pixieset, which is a human job.

**Every detector was negative-tested by making it fire** — thresholds forced to
zero for `STUCK`/`SPINNING`, a temp queue with nothing staged for `STARVED`, and
an agent actually booted out for `BROKEN`. Two bugs surfaced doing that, both of
which would have made the check quietly useless:

* `Number(env) || 4` ignores a deliberate `0`, so the threshold could not be
  forced and the first negative test could not fail;
* passes were counted inside a one-hour window while idles were counted across
  the whole file, so `idles === 0` was never true and the spin detector — the
  one that exists to catch the 34-hour busy loop — could never fire.

Run it by hand any time: `npx tsx scripts/pixieset/stall-check.ts --dry`
(verdict only, sends nothing) or `--force` (send regardless, to prove delivery).

## Install (or reinstall, on a fresh machine)

```bash
cp scripts/pixieset/launchd/*.plist ~/Library/LaunchAgents/
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.twodudes.pixieset.watch.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.twodudes.pixieset.ingest.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.twodudes.pixieset.stallcheck.plist
```

The stall check uses `StartInterval`, not `KeepAlive`: it is a periodic job that
EXITS, and a `KeepAlive` job that exits gets relaunched instantly and spins —
the same trap the ingest loop hit.

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
