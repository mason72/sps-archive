# Contract: how a Pixeltrunk event points at its SPS event

**Written 2026-08-11.** Agreed before both sides ship, because two documents
were about to specify two different keys for the same fact.

Read this before writing anything that links a PT event to an SPS event —
the SPS pull/import work, the guest-list auto-resolve, and anything that
later wants SPS analytics for a gallery.

---

## The one key

```
events.settings.spsEventId   // string, the SPS event's id
```

Flat, not nested. `src/lib/sps-integration/import.ts` has written this key
since SPS import shipped and `/api/sps/enhancements/[eventId]` reads it, so it
is the incumbent and it wins.

**A superseded note in `tasks/todo.md` said `settings.sps.eventId` (nested).
That is wrong — do not write it.** `readSpsEventLink()` still *reads* the
nested shape so a row written against the old note isn't silently orphaned,
but nothing should produce one. As of 2026-08-11, 0 of 19 live events used
either shape, so there is no migration to run — only a mistake to not make.

## The one home

`src/lib/sps-integration/event-link.ts`

```ts
readSpsEventId(settings): string | null          // the common case
readSpsEventLink(settings): SpsEventLink | null  // + display name, linkedAt, source
spsEventLinkPatch({ eventId, eventName, linkedAt, source }): Record<string, unknown>
```

- **Never inline `settings.spsEventId`** at a call site. That inlining is
  exactly what let a second key shape get proposed without anything failing.
- **`spsEventLinkPatch()` returns a patch to MERGE**, never a settings object
  to assign. On an update you must spread it into the event's existing
  settings — `cover`, `sharing` and `guestList` all live in the same bag and
  a wholesale replace eats them.

Companion display fields, written by the same patch:

| field | purpose |
| --- | --- |
| `spsEventName` | **display only.** Shown so a bad link is visible later. Never a key. |
| `spsLinkedAt` | when the link was made |
| `source` | `"sps-import"` (pulled) or `"manual-link"` (picked by hand) |

---

## Matching: don't, wherever possible

**A pulled event arrives already linked.** The importer knows the SPS event id
at creation, so it calls `spsEventLinkPatch()` and there is nothing to match —
ever. This is the main path and it should stay matching-free.

Matching is therefore **backlog-only**: PT events that already existed before
the pull path, and realistically only the few that need a guest list.

### Never match on event name
Names differ between the two systems by routine practice and get renamed on
both sides. More decisively, the payload behind this link is **PII** — guest
names, emails, sign-in answers. A false positive doesn't mislabel a gallery,
it hands one client a different client's guest list. An id is exact; a name is
a guess, and a guess is not an acceptable authorisation for PII.

### Dates rank the picker; a human decides
Never auto-select. Rank candidates and let Mason confirm.

- **Use `images.taken_at`, not `events.event_date`.** The hand-entered
  `event_date` is NULL on **7 of 19** live events. EXIF coverage on `taken_at`
  runs 78–100%, mostly ≥95%, and where both exist they agree on 9 of 12.
- **Derive the calendar day in LOCAL time.** `taken_at` is a timestamp; read
  as UTC, an evening California shoot lands on the following day. Two of the
  three apparent one-day disagreements in the survey were this artifact, not
  bad data. (Same trap as the standing rule: DATE columns format UTC,
  timestamps format local.)
- Match within **±1 day** anyway — free tolerance, costs nothing when a human
  is confirming.
- Rank by date proximity first, name similarity only as a tiebreak.
- Show **date + guest count + name** on every row so a wrong pick is visible
  before the click.

## Surfaces

- **Picker** — inline in the guest-list card on the publish/share page, where
  the need actually arises. Backlog-only, so it does not warrant its own
  settings section.
- **Event settings** — shows the link **read-only** ("Linked to SPS: …"), so a
  bad link stays visible forever rather than only at the instant it was made.
- Both write through one endpoint. Same discipline as the gallery password.

## Optional safety belt

Re-check the SPS guest count at download time and refuse if it is
implausibly different from what was linked. Cheap insurance against a link
that got re-pointed by an edit on the SPS side.
