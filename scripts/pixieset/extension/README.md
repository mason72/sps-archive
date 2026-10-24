# Pixieset Migration Driver — a Chrome extension

Requests Pixieset collections one at a time so the archive migration keeps
running when a tab closes, Chrome restarts, or the Mac reboots.

## Why an extension, when a tab already worked

The in-page driver worked and **died five times** — session teardown, Chrome
restart, tab closed, tab closed, tab gone. Every death was silent, so the
migration sat idle until Mason happened to ask. Downloading was the only stage
that was not a launchd agent, and the only stage that kept stopping.

The obvious fix — a nightly Playwright pass (`download-pass.mjs`) — **does not
work on the mini.** Cloudflare challenged it three times across 26 hours
(2026-08-30 01:00, 2026-08-30 20:24, 2026-09-01 03:14), fresh profile,
`headless:false`, `channel:"chrome"`, with 19 hours of quiet before the last;
the first two at the collection page, the third at the front door. Mason's own
Chrome answers HTTP 200 on the same URL in the same minute.

So the surface has to stay **his** Chrome. An extension is that surface, without
the tab. **We are not evading the protection** — same browser, same cookie jar,
same profile, driven by a timer instead of a hand. If this path ever starts
getting challenged, stop and tell Mason. Never spoof, never add stealth
plugins, never solve a challenge.

## Install (once, ~90 seconds)

1. Chrome → `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → choose this folder
4. Click the extension icon → **Start**

Pin it to the toolbar so the popup is one click away.

To let it handle password-gated collections, sign in to
`galleries.pixieset.com` first, then press **Arm passwords** once. Roughly 282
collections have one. Arming needs that session; *using* the passwords does not,
so it survives the session expiring (~3.5h).

## Download PINs, and "go" without the popup (v1.3.3, 2026-10-24)

The migration cleared every collection's download PIN before it ran
(`emit-pin-clear.mjs`), so for 1,337 collections the download-auth form was
email only. A gallery that arrives AFTER that pass keeps its PIN, and Pixieset's
form then has a second field, `DownloadLoginForm[download_pin]`. Two files in the
gitignored `scripts/pixieset/data/` handle this and the restart that usually
goes with it; the watcher serves both, so editing the file is the whole step:

| File | Served as | What it does |
|---|---|---|
| `data/pins.json` — `{ "<slug>": "<PIN>" }` | `GET /pins` | The scheduler fetches it per drive and the offscreen driver sends the PIN with the form. A stay on the auth form after the POST retires the collection at once with a beacon reason the ledger keeps: `pin-required` (none on record) or `pin-refused`. Fix the file, then a named repair puts the slug back. |
| `data/resume.json` — `{ "at": "<ISO time>" }` | `resumeAt` in the `/disk` body | A human's "go" after a deliberate stop (three Cloudflare challenges, "queue drained"). The extension resumes ONCE per distinct `at` (`s.resumedAt` remembers it), re-arms the tick alarm exactly as the popup's Start does, and resets the challenge count; the three-challenge limit itself is unchanged. Write a new time for the next "go". |

Why a file and not the popup: nothing here can drive a `chrome-extension://`
page, and a stopped extension fires only its 20-minute heartbeat, so that is
where `resumeAt` is noticed (ticks check it too). The PIN values never reach the
repo, a log line, a `note()` or the status snapshot; a `pin-refused` beacon says
only that the PIN on record was refused.

Adding a new gallery after the inventory, start to finish: find its collection
id on the public gallery page (`collectionId` in the HTML), add a `queued` entry
to `data/queue.json` under the lock (`withQueue` in `lib/store.mjs`), put its PIN
in `data/pins.json` if the download form asks for one, add a repair with
`add: [slug]` (and `front` if it should go first), bump `manifest.json`, and
write `data/resume.json` if the extension is stopped. First done for
`oct2026metaeventphotos` (Doug's Meta gallery, 59 previews; the rest of it is a
later `requeue` repair once Doug finishes).

## How it survives what the tab could not

A Manifest V3 service worker is killed whenever it goes idle, so a long-running
loop is impossible — and that is the point. `chrome.alarms` wakes it, it does
**one** collection, persists to `chrome.storage.local`, and exits. Nothing is
held in memory between wake-ups, so a shutdown has nothing to lose. The alarm is
re-armed on `onStartup` and `onInstalled`, because an alarm does not survive a
Chrome restart by itself.

| Piece | Job |
|---|---|
| `background.js` | scheduling, state, downloads. No DOM. |
| `offscreen.js` | the fetch/parse state machine. Has `DOMParser`; no visible tab. |
| `popup.html/js` | status and controls, and it always says WHY it stopped — including which collection is downloading right now. |
| `jobs.json` | the queue, newest-first. Seeds itself on install. |

## It reports, and it reloads itself (v1.1.0, 2026-09-15)

- **Every save is announced to the watcher.** The same status object the popup
  renders is POSTed to `http://127.0.0.1:8788/status` (trailing-edge throttled,
  fire-and-forget), and the watcher writes it to
  `~/pixieset-staging/logs/extension-status.json` with its own `receivedAt`.
  The stall check reads that file, so a STARVED email now carries the
  extension's own last word — "stopped: N deferred for passwords", "silent for
  3h while claiming to run", "downloading hlth2025" — instead of "open the
  popup". A watcher that is down costs nothing here; the stall check reports
  that separately as BROKEN.
- **A code change no longer needs a hand on chrome://extensions.** The brake
  response carries the on-disk `manifest.json` version; when it differs from the
  version the worker was loaded with, the next tick calls
  `chrome.runtime.reload()` — never mid-drive, since an offscreen page is
  automating a form then. **So bump `version` in `manifest.json` with every
  change you want picked up.** A change without a bump is invisible, full stop: a
  Chrome restart does NOT re-read unpacked code (measured 2026-09-15), so the
  bump is the only way in short of the Reload button.

## Every Pixieset request runs inside a real Pixieset tab (v1.3.0, 2026-10-11)

Chrome 154 stopped attaching the profile's Pixieset cookies to fetches made from
the offscreen document, host permissions or not. Two symptoms, one cause:

- **Arm failed** — the admin API answered 401 from the extension while the same
  call from a page tab in the same Chrome answered 200 in the same minute.
- **141 gated collections retired as "password refused"** between 2026-09-24 and
  2026-10-10 (109,700 photos). The guest-login POST succeeded, its Set-Cookie
  landed in a jar nothing kept, and the next GET was gated again, which the
  driver could only read as "wrong password". Plain collections kept landing
  because their flow needs no session, so nothing looked broken.

So `offscreen.js` no longer calls `fetch` on Pixieset at all. `GET`/`POST` send a
`pxfetch` message to the service worker, which finds or opens a pinned
background tab on the request's origin (`ANCHOR`: the collection page for a
drive, `/collections` for Arm) and runs one small fetch there with
`chrome.scripting.executeScript`. First-party by construction; cookies in and
out behave as in a tab because it IS a tab. The parsing and the state machine
did not move. `unlock()` now returns what the server said (`POST 302 →
/<slug>/` vs `POST 200 → /guestlogin/<slug>/`), and that reaches the log and the
beacon, so a future "refused" can be told from "never reached".

Rules this adds:
- **A tab is a sign-in sensor.** If the anchor redirects off its origin (signed
  out: `galleries.pixieset.com` → `accounts.pixieset.com`) the injection cannot
  run, the created tab is closed, and the error names the sign-in. It never
  retries into a pile of tabs.
- **The pinned Pixieset tabs are the extension's; leave them.** Closing one
  costs a reload of the page on the next request, nothing more.
- **`jobs.json` is a seed, not the queue.** It was built once on 2026-08-31, and
  22 collections that joined `queue.json` later sat `queued` for six weeks while
  the extension said "queue drained". The `2026-10-11` repair adds them, and
  `stall-check.ts` now prints "N NOT in jobs.json" beside the queued count. A
  new ledger row still needs a repair `add:` entry (or `jobs.json` + reinstall).

## Invariants worth not breaking

- **`done` is append-only and never cleared on reinstall.** A restart must
  resume, not redo. The one sanctioned exception is a named entry in `REPAIRS`,
  applied once per profile and recorded by id, so putting work back is a
  reviewable line of code rather than a console paste nobody remembers.
- **`done` means the BYTES LANDED, never that Chrome accepted the URL.** Every
  download id is held in `inflight` and confirmed `complete` through
  `chrome.downloads.search` before the collection is retired; interrupted, timed
  out (6h) and "Chrome has forgotten this id" are all failures, because *cannot
  prove it arrived* and *it arrived* must not be the same answer. Retiring on
  request cost five collections and 14,516 photos when the disk filled on
  2026-09-01/02 — the extension moved on, the migration ledger still read
  `queued`, and nothing anywhere said so.
- **It has a disk floor, served over loopback, and it fails CLOSED.** An
  extension cannot see the disk — no API exposes it — so this one requested a
  46 GB collection against 53 GB free on 2026-09-08 and drove the startup volume
  from 117 GB to 47 GB while the ingest sat halted below its own floor, unable to
  drain. `watch.mjs` now serves `http://127.0.0.1:8788/disk`; the extension asks
  twice, because the honest question changes once the size is known: **before the
  drive**, is there room to start anything (80 GB)? **after it**, does THIS
  archive fit and still leave the ingest its 60 GB to work in? A collection that
  does not fit today stays QUEUED — it is not a failure and must not burn an
  attempt. No answer means no download, and `stall-check.ts` probes the same
  endpoint hourly and reports BROKEN if it is down, so failing closed cannot
  stall the migration for more than an hour.
- **One DRIVE at a time, and one collection's downloads at a time.** The alarm
  fires every 20 minutes whether or not the last tick finished, and a drive on a
  big collection takes about 19 — measured 19m on atlassian-team26expo (8,518
  photos, 17 parts, 46 GB). Its ticks overlapped, three drives ran at once for
  the same collection, and each would have requested its own 46 GB archive
  against 113 GB of free disk. The lock lives in storage, not a variable,
  because the worker is evicted between wake-ups; it expires after 110 minutes
  (50 before 2026-09-24) so a drive that died with the worker cannot block the
  queue forever.
- **The tick never waits for a drive to finish.** It dispatches, and the
  offscreen document answers with a `driveResult` message of its own, matched
  to the lock by a token. Chrome kills a service worker that waits ~5 minutes on
  one reply, and a 3,000+ photo build takes longer, so on 2026-09-14/15 every
  such drive finished into a dead channel and four collections were retired as
  "drive never answered" (the one that got through answered in 5m43s). A new
  message wakes a dead worker; a reply on a dead channel does not. Ticks and
  results run one at a time (`serial`), or a tick's stale save would drop a
  result's `inflight`.
- **The build wait scales with the collection (v1.2.0, 2026-09-24).** 2.5 minutes
  per 1,000 photos, never under 35 or over 90, inside the 110-minute lock. A
  flat 35 minutes retired servicenowsko26 (34,274 photos, ~100 GB): its build
  took ~40, so attempt 1 gave up just before it finished and attempt 3's fresh
  build timed out the same way. Measured basis: atlassian-team26expo, 8,518
  photos / 46 GB, built in 19 minutes. The poll slows as it waits (3s for a
  minute, 15s to ten minutes, then 60s), so a 90-minute wait sends ~136 requests,
  fewer than the old 35-minute one (~156).
- **At most six parts download at once (v1.2.0, 2026-09-24).** The rest wait in
  `inflight.queued` and start as earlier parts finish: `downloads.onChanged` is
  the fast path, every tick's `settleInflight` is the backstop, and a set with
  anything still queued is never retired. Starting every part at once lost parts
  in proportion to the count: 1 of 21 (hiltonsummit), 4 of 20
  (servicenowsko2025), 14 of 31 (servicenowsko26), none in any set of 8 or
  fewer. The doomed parts are visible from their first second: Chrome never
  gives them a filename, so they sit as `Unconfirmed NNNN.crdownload` (often 0
  bytes) until they die as NETWORK_FAILED, and they never get a row in Chrome's
  History database. Whether Chrome or `downloads.pixieset.com` drops them was
  not provable offline. The cap costs nothing: the Studio's link tops out near
  100 MB/s and 4-5 parts already reach it.
- **A retry fetches only the parts that are missing, and the disk gate asks
  only about those.** Pixieset regenerates the whole archive per request, so a
  retry hands back 17 fresh links even when 16 of those parts are on disk.
  `alreadyHave()` skips any part Chrome has already completed and still has
  (proven on hiltonsummit and servicenowsko2025, both verified). It runs before
  the disk gate, which used to count the whole archive and would have set
  servicenowsko26 aside as needing ~100 GB with 55 GB of it already on disk.
  So **never move or rename landed parts of an incomplete set** out of
  `~/Downloads`: `exists: true` goes false and the retry fetches them again. Mixing generations is checked rather than assumed:
  `verifyArchive` quarantines a set whose file count or dimensions disagree.
- **One failed part does not discard a set that is still landing.** The first
  version gave up the moment any download reported interrupted, which threw away
  16 of 17 landed parts because part 17 hit NETWORK_FAILED. The verdict now waits
  until nothing is in flight, and healthy transfers are never cancelled.
- **One collection's downloads at a time.** A tick that finds bytes still in
  flight does nothing else, so a 47 GB request cannot race the ingest for the
  same free space. A failed settle costs a full gap before the retry, because the
  usual cause is a full disk and that needs the ingest to drain.
- **A gated collection with no password armed is DEFERRED, not done.** Marking it
  done would silently retire all 282 in one unarmed run.
- **A deferred collection must be SKIPPED when choosing the head, and `arm` must
  put it back.** The head used to be "first job not `done`", so a deferral
  returned the same slug to position 0 every 20 minutes: `sjcbubblebash-2026` was
  requested and deferred **104 times across 32 hours** while 1,191 collections
  behind it were never reached. That is the `apannualconferenceblue` livelock
  this file already documented, arriving through a second door — fixing one
  instance of a failure mode does not retire the failure mode. The two halves are
  one rule: skipping without re-arming on `arm` turns a livelock into a silent
  omission.
- **"Queue drained" and "everything left is gated" are different stopped
  reasons.** Saying the first when the second is true reads as a finished
  migration.
- **A failure leaves the collection queued for three attempts, then retires it
  WITH A RECORDED REASON.** Transient R2/network errors deserve a retry; an
  unbounded one at the head of the queue is the livelock above. 404/410 is
  permanent and retires immediately as `gone`.
- **Three Cloudflare challenges stop the run** and record why. Do not raise that
  number.
- **No filename is supplied to `chrome.downloads`.** Pixieset's
  `Content-Disposition` produces `{slug}-photo-download-NofM.zip`, which is
  exactly what `watch.mjs` matches. Inventing a name breaks the handoff.
- **High Resolution only** (`Download[download_size]=1`), and prefer a fresh
  build over "download existing" — an existing archive may be a client-generated
  Web Size copy, and only pixel dimensions can tell them apart.
- **Passwords are Mason's clients' passwords.** They live in
  `chrome.storage.local` and must never be logged, printed, or sent anywhere.

## Diagnosing lost downloads offline

The popup and `extension-status.json` keep only the last 12 log lines, and
`watch.log` has no timestamps. **Chrome's own History database is the durable
record**: copy `~/Library/Application Support/Google/Chrome/Default/History`
(Chrome holds a lock) and query the `downloads` table (start/end time, bytes,
`interrupt_reason`) and `downloads_url_chains`. **A gap in the `id` sequence
inside one collection's run is a lost part**: an unconfirmed download never gets
a row. Match it to `Unconfirmed *.crdownload` birth times in `~/Downloads`
(`stat -f %SB`). Never print a `url_chains` URL whole: `filestart?fid&filekey`
is a live download credential; print the host and parameter names only. Those
orphaned `.crdownload` files are Chrome-forgotten and safe to move to the Trash.

## Tests

```bash
node --test scripts/pixieset/extension/background.test.mjs
```

Forty-eight tests over the scheduler, loaded against a stub `chrome`. Both bugs they
guard were live and both were silent, so the interesting ones are the negative
cases: a deferred collection must leave the head, a download Chrome has
forgotten must count as a failure, and a repair must not run twice.

## Retirement beacons — how a NEGATIVE outcome reaches the ledger

Everything downstream is evidence-driven: a ZIP appears, so a collection is
verified. Nothing carried the other answer. When this extension gives a
collection up — gone from Pixieset, downloads switched off, password refused,
three failed attempts — `queue.json` went on reading `queued` for it, and the
two records disagreed with nobody to notice.

So a retirement now writes `px-retired-{slug}.json` into `~/Downloads`, which
`watch.mjs` already sweeps every 20 seconds. It records the collection as
`failed` with the reason and files the beacon in `pixieset-staging/retired/`.

- **The slug lives in the BODY, not the filename.** Chrome dedupes a repeat as
  `px-retired-x (1).json`, and identity read out of a filename is one suffix
  away from wrong — the same trap the ZIP name parser exists for.
- **A filename IS supplied to `chrome.downloads` here**, the single exception to
  the rule above: a blob has no `Content-Disposition` to take one from.
- **A deferral is not a retirement and writes nothing.** A ledger row reading
  `failed` for work that is merely waiting on a password is a lie with a long
  half-life.
- **Bytes beat beacons.** A collection already `verified` or `ingested` has its
  beacon filed and ignored, never obeyed — that check is re-run against fresh
  queue data inside the lock.
- **A beacon that fails to write is shouted about** in the log. One that
  silently does not arrive is the same fail-open shape the beacon exists to end.
- The blob URL is minted in the offscreen document, because a service worker has
  no `URL.createObjectURL`. It is revoked after the download completes.

## What it does NOT do

Everything after the download: `watch.mjs` proves and stages the ZIP,
`ingest-loop.sh` imports it, `stall-check.ts` shouts if the pipeline goes quiet.
Those are launchd agents and already work. This extension only fills
`~/Downloads` — with archives, and with the occasional beacon saying an archive
is never coming.
