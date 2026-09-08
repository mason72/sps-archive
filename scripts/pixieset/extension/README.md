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

## Tests

```bash
node --test scripts/pixieset/extension/background.test.mjs
```

Nine tests over the scheduler, loaded against a stub `chrome`. Both bugs they
guard were live and both were silent, so the interesting ones are the negative
cases: a deferred collection must leave the head, a download Chrome has
forgotten must count as a failure, and a repair must not run twice.

## What it does NOT do

Everything after the download: `watch.mjs` proves and stages the ZIP,
`ingest-loop.sh` imports it, `stall-check.ts` shouts if the pipeline goes quiet.
Those are launchd agents and already work. This extension only fills
`~/Downloads`.
