# The migration runs as four launchd agents

Set up 2026-08-16, after the pipeline stopped **three times in one day** and each
time it was Mason who noticed, not the tooling:

1. the ingest loop lived inside a session's shell, so it died with the session;
2. a partial ingest (9 transient upload errors out of 322 photos) halted the
   whole 1,342-collection queue;
3. the Mac rebooted and took every process — and the logs, which were in `/tmp`.

A multi-week migration cannot depend on someone remembering to restart it.

| Agent | What it does | Log |
|---|---|---|
| `com.twodudes.pixieset.download` | nightly 03:20 — requests the next batch of ZIPs | `~/pixieset-staging/logs/download.log` |
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
| `STARVED` | nothing staged, work queued, nothing done in > 36h | the download agent — read `download.log` |

`STARVED` was the four-day case, and it used to be Mason's job: the download half
needs Chrome pointed at Pixieset, and until 2026-08-28 that meant a human doing
it. `com.twodudes.pixieset.download` closes that gap. `STARVED` now means the
download agent is not producing work, and `download.log` says why — the three
causes it distinguishes are a Cloudflare challenge (exit 3), the staging disk
floor (exit 4), and an empty or fully-gated queue (exit 0).

## The download agent

```bash
node scripts/pixieset/download-pass.mjs [--limit N] [--budget GB] [--at-risk]
node scripts/pixieset/download-pass.mjs --collection <id>   # one, for testing
node scripts/pixieset/download-pass.mjs --dry               # plan only, no browser
```

It is the conveyor between two halves that already ran themselves: it asks
`store.mjs` for the next batch, drives the existing `driver.js` state machine in
a real browser, saves ZIPs where `watch.mjs` already looks, and hands the report
to `apply.mjs`. No state, expiry or fidelity rule is re-implemented in it.

**Headed, real Chrome — both are load-bearing.** Measured 2026-08-28 on
`twodudesphoto.pixieset.com`, same machine, same Playwright, same Chrome binary,
fresh profile, the ONLY difference being the flag:

| | result |
|---|---|
| `headless: true` | HTTP 403, `cf-mitigated: challenge`, "Just a moment…" |
| `headless: false` | HTTP 200, no mitigation, download-auth link present |

This corrects a "settled" note in `tasks/pixieset-migration.md` that read
"Playwright loops on Turnstile forever … `login.mjs`/`pilot.mjs` currently
unusable". That was measured against the hardest surface (`accounts.pixieset.com`
Turnstile login) using the BUNDLED Chromium, and the conclusion generalised one
step too far. The axis is headed-vs-headless and real-Chrome-vs-bundled-Chromium,
not Playwright vs a human. **The protection itself is still not to be defeated** —
no UA spoofing, no stealth plugins, no solvers. If this path starts getting
challenged, stop and tell Mason.

**It is budgeted in BYTES, not collections.** The queued median is ~565 MB but
p90 is ~4.7 GB and the largest is ~47 GB, so "10 collections" can mean 3 GB or
60 GB — and a count-based guard is not a capacity guard. The pass fills against
`--budget` GB *and* `--limit`, whichever binds first, and re-checks free space
between collections because the ingest is draining concurrently. Anything larger
than the whole budget gets a loud line every single pass, because nothing else
would ever surface it.

**It pre-skips collections whose bulk download is switched off.** 21 queued
collections have `collection_download: false`, and **20 of them are among the 40
oldest** — a two-day pet-portrait run from Jan 2015 that sits at the very front
of oldest-first ordering. Left in, the first two nights would spend themselves
marking failures and the migration would look broken when it is merely gated. The
list comes from the inventory sweep already on disk
(`~/pixieset-staging/pixieset-inventory.json`), never from a live probe.

**Releasing an archive does NOT free the space — snapshots pin it for ~24h.** Six
presence-verified ZIPs (9.1 GB) were deleted on 2026-08-28 and free space did not
move by a single GB, because Time Machine's hourly APFS local snapshots still held
the blocks. This matters more for a nightly job than it did for hand-runs: the
space released tonight is not available tomorrow night, so the effective headroom
is roughly one pass smaller than `df` suggests. That is why `--budget` is set well
below actual headroom.

The blocks drain on their own as snapshots age out (~24h), or immediately with:

```bash
tmutil thinlocalsnapshots / 21474836480 4
```

That deletes **local** snapshots only — the real restore points on the external
Time Machine volume are untouched. Measured 2026-08-28: 8 local snapshots thinned,
66 GB → 97 GB free. Worth running before raising `--budget`, and worth checking
first when the pass exits 4 (disk floor) despite archives having been released.

⚠️ **Never release a staged archive on a count check.** Use
`npx tsx scripts/triage/px-filecheck.ts <eventId> <zip>...`, which compares ZIP
entries against `images.original_filename` and exits non-zero on any miss.
`verifyLanded()`'s `total >= expected` is satisfied trivially when an event holds
images from more than one source — see lesson 87.

**Rate limiting is not optional.** Cloudflare challenged this host on 2026-08-28
after roughly fifteen browser sessions in twenty minutes — all of it
*investigation* traffic, not production. Investigation counts against the same
budget as the pass itself. The pass paces at 30s between collections by default
(`--gap-seconds`) and requests ~10 a night; do not tighten either to "catch up".

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
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.twodudes.pixieset.download.plist
```

The download agent needs `npm install` in `scripts/pixieset/` plus
`npx playwright install chromium` — the Playwright runtime was absent on this
machine as of 2026-08-28, which is why `login.mjs` and `pilot.mjs` could not run
at all. It also needs real Chrome at `/Applications/Google Chrome.app`.

**All four are LaunchAgents and the download one must stay one.** It drives a
headed window, so it needs a logged-in GUI session (`launchctl managername` →
`Aqua`). A locked screen is fine; a logged-out mini is not.

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
