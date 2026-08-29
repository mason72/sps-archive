# Pixieset download autopilot — build report

**Worked 2026-08-27 → 2026-08-28, on the mini (the only machine allowed to run this pipeline).**

**Status: built, documented, and NOT armed.** The end-to-end test did not pass, so the
nightly agent is deliberately left uninstalled. An untested restart policy is a belief,
not a guarantee, and that bar is the one the other three agents were held to.

---

## 1. The verdict found before touching anything

```
Verdict: STARVED
ingested   40 of 1371
queued     1326
staged     0 waiting to ingest
last done  2026-08-24T01:36:07Z (70.5h ago)
agents     watch=up  ingest=up
last hour  12 passes, 12 idles
```

`launchctl list` showed all three existing agents healthy (watch and ingest with live
PIDs, stallcheck scheduled). The ingest was idling correctly at 300s — the 2026-08-18
busy-loop fix is holding, confirmed by 12 idles in 12 passes.

**The verdict is now `OK`, and that is not progress.** Over the two days this session
spanned, the ingest drained the last two staged collections (eaze Holiday Party 2016,
eBay HR Fair), so `last done` is recent and the check reads healthy. Nothing new was
downloaded. Queue state is unchanged at **1,324 queued / 42 ingested / 5 failed**, and
`STARVED` will return roughly 36h after the last drain.

---

## 2. What was built

One new script, `scripts/pixieset/download-pass.mjs`, plus a launchd plist. It is not a
new pipeline — it is the missing conveyor between two that already ran themselves:

```
store.mjs (next batch) → driver.js (in a real browser) → apply.mjs (queue states)
                                    ↓ ZIPs to ~/Downloads
                          watch.mjs → ingest-loop.sh   [already automated]
```

No state, expiry, or fidelity rule is reimplemented. `apply.mjs` remains the only writer
of queue transitions; `store.mjs` still owns the 7-day expiry definition.

Design points that are load-bearing, each with its reason in the file header:

- **Bounded one-shot.** Requests N collections, then exits. `StartCalendarInterval`,
  never `KeepAlive` — a `KeepAlive` job that exits gets relaunched instantly and spins,
  which is the 34-hour CPU burn from 2026-08-18.
- **Fails closed and loud.** A `preflight()` gate proves the gallery is reachable before
  anything is requested. Distinct exit codes: `0` worked or correctly idle, `3` blocked
  and needs a human, `4` disk floor reached. No silent retry loop anywhere.
- **Budgeted in bytes, not collections** — see §5.
- **Pre-skips the 21 gated collections** — see §4.
- **Paces at 30s between collections** and requests ~10 a night.

---

## 3. Two corrections to things the repo recorded as settled

### 3a. Playwright is usable. Headless is not.

`tasks/pixieset-migration.md` says Cloudflare "challenges every non-browser client on
both Pixieset hosts … Playwright with a persistent profile was built and abandoned for
this reason (`login.mjs`, `pilot.mjs` — kept for reference, currently unusable)."

Measured 2026-08-28 on `twodudesphoto.pixieset.com/{slug}/`, same machine, same
Playwright, same real-Chrome binary, fresh profile, the **only** difference being the flag:

| | result |
|---|---|
| `headless: true` | HTTP 403, `cf-mitigated: challenge`, "Just a moment…" |
| `headless: false` (`channel: "chrome"`) | HTTP 200, no mitigation, `/download/auth/` link present |

The original note was measured against the hardest surface (`accounts.pixieset.com`
Turnstile login) using the **bundled Chromium**. The conclusion generalised one step too
far: the axis is headed-vs-headless and real-Chrome-vs-bundled-Chromium, not Playwright
vs a human.

**This does not license defeating the protection**, and the header of `download-pass.mjs`
says so explicitly: no UA spoofing, no stealth plugins, no TLS mimicry, no solvers. It
means a scheduler may start the same window a person would.

Consequence: the agent must be a **LaunchAgent**, not a LaunchDaemon, and the mini must
stay logged in. A locked screen is fine; a logged-out one is not.

### 3b. A real bug in `driver.js`, found by running it

Every collection failed at phase `auth` with `unexpected path /download/auth/…`. The
driver POSTed the email gate **directly at the gallery page's `/download/auth/{slug}/?dt=`
link, without GETting the auth page first**, so the exchange that GET performs never
happened and the gate simply re-served itself.

Fixed (`driver.js` v3 → v4): `authenticate()` now GETs the auth page, reads the action and
the submit button's value off the returned form, preserves any hidden fields, and POSTs
that. Verified against the live form, whose contract is otherwise unchanged
(`DownloadLoginForm[email]` + `yt0`).

**The fix is written but has never completed a run** — see §6. It is the most likely
remaining source of failure and should be treated as unproven.

---

## 4. The 5 "Web Size" failures — it is neither of the two options in the brief

The brief asked whether the fix is a per-collection or a plan-level Pixieset setting.
The evidence says **neither: our own fidelity guard is misfiring.**

The guard (`lib/archive.mjs`):

```js
const uniformWidth = widths.length >= 3 && widths.every(w => w === widths[0]) ? widths[0] : null;
isRendition = uniformWidth != null && uniformWidth <= RENDITION_WIDTH_MAX;  // 2560
```

Three independent facts, none of which needed the Pixieset account:

1. **None of the five can be a Web Size rendition.** All five carry `web: 2` in the
   inventory, which the repo decodes as **1024px**. Observed widths are 1920, 2560, 1920,
   2560, 2432. Not one is 1024.
2. **Four of the five sit at exactly width ÷ long-edge = 0.6667** — width is the *short*
   edge of a 3:2 frame, i.e. these are portrait-orientation photos, at 1920×2880,
   2560×3840 and 2432×3648. Those are camera aspect ratios, not renderer output.
3. **`boxworks2014headshotsday3` is ALL PORTRAIT** — probed from its public gallery:
   16 portrait, 0 landscape, 1 square. An all-portrait gallery has uniform width *by
   construction*, because every vertical frame off one body shares a short edge. The
   guard cannot tell that apart from "a renderer capped the width."

`high_res_download_size` is already resolved account-wide: all 30 affected collections
were set to Original on 2026-08-14, verified four ways, zero remaining. So there is no
settings change left to make, and the error message these five carry — *"Re-request this
collection at High Resolution"* — is wrong advice.

**A weakness worth fixing regardless of the verdict:** the guard samples 5 frames. On
`lafayetteartandwinefestivaldaytwo`, which is genuinely MIXED (88 portrait / 17
landscape), five portrait draws happen ~42% of the time — so it false-positives on
mixed galleries too, not just all-portrait ones.

**Proposed fix, not applied.** A rendition caps width regardless of orientation; a camera
does not. So uniform width is only evidence of a rendition when the sample contains
*both* orientations:

```js
isRendition = uniformWidth != null && uniformWidth <= RENDITION_WIDTH_MAX
              && (mixedOrientation || uniformWidth === WEB_SIZE_WIDTH);
```

Left unapplied deliberately: this guard is the only thing standing between the archive
and silently storing web-size junk, and the definitive check is one API call away once
the session is restored — compare the ZIP's frame dimensions against the API's
`width`/`height` for the same photos. If the API agrees, the downloads were always fine
and the five can be walked forward; if it reports larger, there is a real problem. That
check needs the owner session, so it is on the list below.

---

### 4b. SETTLED 2026-08-28 evening — and the proposed fix in §4 is WRONG. Do not apply it.

§4 said the definitive check needed the owner session and one API call. It needed
neither. **Pixeltrunk stores `width`/`height` for every ingested image**, so the full
population of the 53 already-accepted collections is a ground-truth control set sitting
in the database — a far stronger comparison than a 5-frame sample against the API, and
it costs no Pixieset traffic at all.

**The sibling proof.** `lafayetteartandwinefestivaldayone` — 861 photos, 836 portrait /
25 landscape, modal 3840 long × 2560 wide — is **ingested**. Its twin
`…daytwo` was quarantined for *"every sampled frame is 2560px wide (median long edge
3840)"*. Same two-day event, same body, same geometry. At 836/861 portrait roughly 86%
of 5-frame samples come out all-portrait, so day one passed only because its sample
happened to include a landscape frame. The verdict is close to a coin flip.

**The geometry is established archive material:**

| quarantined | geometry | ingested collections at the SAME geometry |
|---|---|---|
| boxworks2014headshotsday3 | 1920×2880 | boxworks2014day1, boxworks2014headshots, rsac2015, kiamom — **5,469 photos** |
| ffdc2015, lafayette…daytwo | 2560×3840 | lafayetteartandwinefestivaldayone, kiaclassicportraits |
| foothillsteamphotos | 2432×3648 | redoak2016holidayparty |

**The bug is the SAMPLE SIZE, not the predicate.** Across all 53 ingested collections,
**no multi-photo collection has a uniform width over its full population** — the minimum
is 2 distinct widths and the 98%-portrait ones still carry 4–7. Uniform width genuinely
is a rendition tell; five frames is simply too few to measure it. Raising the sample is
the better fix, and it can be regression-tested offline against the real width
distributions now available in the DB.

**Why the §4 fix must not ship.** `isRendition = uniform && uniform <= MAX &&
(mixedOrientation || uniform === 2048)` carries a dead clause: not one of the five sits
at 2048, so `mixedOrientation` does all the work. It is the inference the brief warned
against, wearing a conjunction as a disguise.

**`jonathanandcat` is UNDETERMINED by geometry** — uniform 1920 wide with a long edge
also 1920, so landscape or square at 1920. It is tempting to call it the one real
suspect; that is wrong. `tenable80sparty` was accepted and ingested with a modal long
edge of **1844**, below 1920, and escaped the guard only because its crops vary (32
distinct widths). Geometry cannot separate this one. EXIF capture-dimensions vs actual
decoded pixels can, and that probe should be validated on a known-good ZIP before it is
trusted — if EXIF is absent or disagrees on a real original, the idea is dead and we
say so rather than shipping it.

**Status: the guard is UNCHANGED and the five remain `failed`.** Nothing was loosened.

## 5. Throughput, and the thing that actually governs it

**The staging disk is the governor, not the downloader.** Staging is on the internal
disk with a 60 GB floor (`PIXIESET_MIN_FREE_GB`) against 77–85 GB free — roughly
**17–25 GB of working headroom**. The queued median is ~565 MB, but p90 is ~4.7 GB and
the largest is ~47 GB, so a count-only limit ("10 a night") can mean 3 GB or 60 GB. The
pass therefore fills against a **byte budget** and a count cap, whichever binds first,
and re-checks free space between collections because the ingest drains concurrently.

Simulated against the real queue (1,302 eligible collections, ~2,136 GB, at 1.42 MB/photo):

| settings | nights | finish | never attempted |
|---|---|---|---|
| `--limit 10 --budget 6` | 384 | ~2027-09-17 | 9 |
| **`--limit 10 --budget 8`** (armed default) | ~300 | **~2027-06** | 9 |
| `--limit 10 --budget 10` | 250 | ~2027-05-06 | 9 |
| `--limit 12 --budget 15` (needs 25 GB headroom) | 175 | ~2027-02-20 | 6 |

Because the queue is sorted oldest-first and at-risk means pre-2024, **the 788 at-risk
collections (~851 GB) come first automatically** — roughly the first 110 nights, so the
irreplaceable set is off Pixieset around **December 2026** at the armed default. No
`--at-risk` flag needed.

**A bug this modelling caught in my own code.** The first version had only a nightly
budget and skipped past anything that did not fit. Against the real queue that silently
stranded **83 collections / 819 GB — 38% of everything remaining** — because a 9.8 GB
gallery never fits a 6 GB night, on any night, forever. Fixed: the fill is now strictly
oldest-first and never skips past a merely-too-big collection. If it is first and the
batch is empty it gets the night to itself; otherwise the pass stops so it leads
tomorrow. Only 9 remain genuinely un-runnable — those exceed 75% of current headroom and
get a loud line every pass.

**The lever, if 9 months is too slow:** more staging headroom. The external SSD this job
was originally designed around would move the finish date by months. That is a decision
for Mason, not a code change.

---

## 6. The test did not pass, and why the agent is not armed

Required: one collection end-to-end (request → ZIP lands → watcher stages → ingest
completes → queue advances). **Not achieved.**

What happened, in order:

1. First live run on `purestoragebodgroupportrait` (3 photos) — preflight passed, the
   driver reached the email gate and failed with `unexpected path /download/auth/`. That
   found the real `driver.js` bug in §3b.
2. Fixed the driver, re-ran two minutes later — **`✗ BLOCKED — Cloudflare challenged the
   gallery host (HTTP 403, cf-mitigated: challenge)`**.
3. Waited ~55 minutes and tried once more. Still blocked. **Stopped there.**

**I caused the block.** Investigating, I ran roughly fifteen browser sessions against
that host inside twenty minutes — four Cloudflare probes, nine orientation probes (each
scrolling six times to force lazy-loaded thumbnails), a form probe, and two passes. That
is scraping-shaped traffic, and the repo's own warning is explicit that being blocked is
the expensive failure. Investigation traffic counts against the same budget as the
pipeline's.

I did not retry beyond those two attempts and did not attempt any workaround, per the
standing rule that the agent stays on and the command changes.

**The guard behaved exactly as designed** — failed closed, said which of the three causes
it was, exited non-zero, and started no retry loop. That much is proven. What is *not*
proven is the happy path.

The queue was left exactly as found: the test collection was walked back from `failed` to
`queued` (`1,324 queued / 42 ingested / 5 failed`). Nothing was downloaded, staged, or
ingested. No production write occurred. A live-event check was run first and was clear —
the only recent upload activity was the migration's own ingest, 0 pending rows.

---

## 7. 🎯 Mason's move

Three things, in order. The first is the only one blocking the autopilot.

**1. Confirm the block has cleared, then run the one-collection test.** Give it several
hours to a day — do not hammer it. Then:

```
cd ~/Projects/SPS/sps-archive && node scripts/pixieset/download-pass.mjs --collection 18964981
```

A pass ends with `✓ purestoragebodgroupportrait — 1 part(s)` and a ZIP in `~/Downloads`.
Watch it through: `tail -f ~/pixieset-staging/logs/watch.log` then `ingest.log`, and
confirm `queue.mjs show 18964981` reaches `ingested`. If it still says `BLOCKED`, try
`rm -rf scripts/pixieset/profile-chrome` first — that profile may be carrying the
challenge. **Only arm the agent after that passes:**

```
cp scripts/pixieset/launchd/com.twodudes.pixieset.download.plist ~/Library/LaunchAgents/
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.twodudes.pixieset.download.plist
```

**2. Refresh the Pixieset owner session.** It is dead — `GET /api/v1/user` returns **401**,
and the cookie has decayed back to a browser-session cookie (`expires -1`), which matches
the 2026-08-21 expiry noted in `driver.js`. Interactive, so it has to be you; I did not
attempt credential entry.

```
cd ~/Projects/SPS/sps-archive && node scripts/pixieset/login.mjs
```

Note the Playwright runtime was **absent from this machine entirely** — `node_modules`
and the browser cache were both gone, so `login.mjs` and `pilot.mjs` could not have run
at all. I installed both (`npm install` in `scripts/pixieset/`, `npx playwright install
chromium`).

The nightly download pass does **not** need this session — the download flow is public
and email-gated. It unblocks the other two items.

**3. Decide on the 21 gated collections** (14,342 photos, ~20 GB). These have bulk
download switched off, so the driver cannot begin — verified live on `accalia-huskyhybrid`
and `shaughn`: HTTP 200, correct page, no `/download/auth/` link. **20 of them are among
the 40 oldest**, a two-day pet-portrait run from Jan 2015 sitting at the very front of
oldest-first ordering, which is why this looked systemic. The pass now pre-skips them
from the inventory already on disk, so they cost nothing — but they will never migrate
until the setting is flipped.

The repo's decision from 2026-08-15 was *flip the setting, pull, flip back*, with the
originals captured to `~/pixieset-staging/pixieset-download-settings-backup.json` first.
That is still the plan and it is **still not executed**. It needs the owner session from
item 2. I have not written the flip script — say the word and I will, gated on a dry-run
diff against that backup.

---

## 8. Files

| file | what |
|---|---|
| `scripts/pixieset/download-pass.mjs` | **new** — the nightly bounded pass |
| `scripts/pixieset/driver.js` | v3 → v4, email gate goes through the form (§3b) |
| `scripts/pixieset/launchd/com.twodudes.pixieset.download.plist` | **new** — 03:20 nightly, not installed |
| `scripts/pixieset/launchd/README.md` | fourth agent documented, `STARVED` row updated |
| `scripts/pixieset/.gitignore` | ignore `profile-chrome/` (the real-Chrome profile) |

Playwright was reinstalled but is not in the diff — `node_modules/` and
`package-lock.json` are both gitignored here, so a fresh machine still needs
`npm install` + `npx playwright install chromium` by hand (documented in the
launchd README).

Unchanged on purpose: `store.mjs`, `apply.mjs`, `watch.mjs`, `ingest-loop.sh`,
`stall-check.ts`, and `lib/archive.mjs` (see the unapplied guard fix in §4).
