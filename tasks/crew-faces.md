# Crew faces — design notes

Status: **built and live** (2026-08-15, same day). The design below survived
contact with the build intact; deltas from it, at the bottom. Migration 061;
lib `src/lib/crew-faces/`; UI `src/components/crew/`.

Mason: *"We often have setup photos with crew faces (almost never named
properly lol). It will be especially helpful to remember who random one-time
hires were."*

The goal is recognition, not search: **look at a name on a rebook sheet and
know the face.** Everything below serves that.

---

## What the data says (measured, not assumed)

Run `npx tsx scripts/triage/crew-face-yield.ts` to refresh these.

| | |
|---|---|
| active crew | 61 (15 regulars) |
| person clusters archive-wide | 5,299 — **1,492 named, 3,807 unnamed** |
| crew already named in a cluster | **2** (Mason Foster, Nicole Allen) |
| unnamed clusters with ≥3 faces | 3,167 |
| crew linked to **no** event | **49 of 61** |
| crew on exactly one event | 3 |
| crew on several events | 9 |

Four consequences, and each one killed an approach that sounded obvious:

**1. The existing auto-naming will never find crew.** Cluster names come from
FILENAME CONSENSUS, and a filename names the *subject* — the client being
photographed. The photographer holding the camera is never in it. 2 hits out of
5,299 clusters, and both look like cases where the crew member was in front of
the lens for once. So crew live permanently in the unnamed pile and no amount of
the current machinery moves them out. Crew identity has to come from a
DIFFERENT signal.

**2. "Find their face in the events they worked" is unavailable for 80% of the
roster.** 49 of 61 crew have zero `event_crew` links — the table holds 40 links
across 12 people, because linking only started when Event Intel shipped. It
grows every time a gig is confirmed on the create or import screen, but today
"show me Joey's galleries" answers for 12 people. **Upload and tag-anywhere are
the primary seeding paths, not the fallback.**

**3. 3,167 candidate clusters is not something you scroll.** An "is this Joey?"
row cannot be a browse. It has to be a QUERY: take the person's reference face,
search by embedding, propose the top few. Which is lucky, because —

**4. The engine already exists.** `matchSelfie()` (`src/lib/faces/selfie-match.ts`)
embeds an image in memory, hits `search_faces_by_embedding`, and votes for a
person. That is exactly "who is this?" pointed at a crew photo instead of a
guest selfie. It is built, calibrated and in production. Crew matching is that
function run archive-wide rather than event-scoped.

---

## The model

Two new tables. Deliberately NOT a column on `crew`, and deliberately NOT
writing crew names into `persons.name` — see the two rules below.

```
crew_faces          one row per reference image for a person
  crew_id           → crew
  user_id           ownership, always (service client bypasses RLS)
  embedding         vector(512), ArcFace — the thing matching actually uses
  image_id          the archive photo it came from, when it came from one
  face_id           the specific detection within it
  storage_key       R2 key for the crop, PRIVATE bucket
  is_avatar         exactly one true per crew member
  source            'upload' | 'tagged' | 'confirmed-suggestion'
  created_at

crew_persons        "this cluster, in this event, is this person"
  crew_id → crew
  person_id → persons
  user_id
  confirmed_by      'human' | never anything else at write time
```

### Rule 1 — a reference SET, not one face

ArcFace across years, beards, weight and hair wants several references. One
photo is a bad day away from never matching again. `crew_faces` is a set;
`is_avatar` marks the one you look at.

Mason: *"there should be a way to pin a photo in the gallery so that becomes
their avatar. Pin or star or whatever makes sense."* — that is `is_avatar`, and
it pins a **face detection**, not a photo, so the avatar is a face crop rather
than a wide group shot the person happens to be in.

### Rule 2 — never write a crew name into `persons.name`

Tempting, because the clustering already has a name field. Wrong, because
`persons` is the GUEST identity space: the People index, the wall of fame, and
guest selfie search all read it. Verified 2026-08-15 that no guest gallery route
touches `persons` today — but "today" is the whole risk. Naming Joey into a
client's gallery puts a staff member into the same namespace as the client's
guests and one future feature away from a share.

`crew_persons` keeps the association internal and reversible. Same reasoning as
`/intel` itself: **crew data is back-office and there must never be a share path
to it.**

---

## Where faces get IN (in order of how much they matter)

### a. Tag a face in any gallery — the workhorse

Every indexed photo already has `faces` rows with bounding boxes. "Tag crew" on
a photo → pick a box → choose a roster member (or add a temp). Writes a
`crew_faces` row with that face's existing embedding. **No new AI, no upload, no
Modal call** — the vector is already computed and sitting in the row.

This is also where Mason's pin lives: the same picker, with a star.

### b. At import review, before the setup frames are thrown away

⚠️ **The tension he did not raise, and it is the important one.** The richest
source of crew faces is setup frames — and the SPS import review screen exists
precisely to UNCHECK those before they reach the archive. The photos with the
crew in them are the ones being deliberately discarded.

Two ways out, and this is a decision for Mason:

- **Tag before dropping.** The review grid is already on screen with those
  frames in it; a "that's crew" action there captures the face and still leaves
  the frame unimported. Cheapest, and it is the moment he is already looking.
- **Keep a few in a non-delivered section.** More faithful (you keep the source
  image) but it puts setup frames back in the archive, which the whole review
  step is designed to prevent.

Recommend the first. The reference is an embedding plus a crop, not the
full-resolution frame.

### c. Upload a photo on the Intel crew panel

The seed path for the 49 crew with no events at all. Detect → one face becomes
the reference, several faces means pick one. Straightforward and necessary; just
not the volume path.

### d. Confirming an "is this Joey?" suggestion

A confirmed match adds that face to the reference set, so recognition improves
with use. This is the compounding one.

---

## Where faces show UP

- **A small avatar wherever a crew name appears.** The Intel crew list and
  detail panel, the event page's crew strip, the create screen's confirm card,
  the SPS import card, every crew picker. The create/import cards are the
  highest-value placement Mason did not list: *"is this the Nicole I think it
  is?"* asked at the moment he is rating her.
- **Degrade to initials**, never a broken image or a blank circle. Most of the
  roster will have no face for a while, and a blank reads as an error.
- **A crew section on `/people`**, between the guest wall of fame and all faces,
  with the toggle he described.

  Open question for him: he asked for **regulars as the default**, but his own
  reason for the feature is remembering one-time hires — the people he cannot
  already name on sight. **Non-regulars may be the better default.** Worth
  deciding, not assuming.

- **"Is this Joey?" as its own suggestion card type.** Slots into the existing
  suggestions engine beside mislabel / refine-name / merge / split, and inherits
  the standing rule: **AI suggests, humans apply.** A wrong face silently
  attached to a rebook judgement is worse than no face at all.

---

## Things to get right

- **Private storage.** Avatar crops go in the archive bucket behind an
  authenticated route, never the public `r2.dev` lane the marketing site uses.
- **Per-person delete.** One button that removes the references, the crops and
  the cluster links. A freelancer can ask, and the answer has to be easy.
- **Gate it with Event Intel.** Crew faces are crew data — same
  `hasIntelAccess()` gate as the rest (`src/lib/event-intel/access.ts`), for the
  same reason.
- **Confidence is shown, never hidden.** A proposal says how sure it is; an
  accepted match says a human accepted it.

## Order of work

1. `crew_faces` + `crew_persons`, avatar storage, the avatar component with its
   initials fallback. Nothing recognises anything yet — but every name in the
   app can already carry a face.
2. Tag-a-face in a gallery, with the star. This is what fills the table.
3. Archive-wide `matchCrew()` — `matchSelfie()` pointed at a reference face —
   plus the "is this Joey?" card.
4. The `/people` crew section and its toggle.
5. Capture at import review, and a face on the temp adder.

---

## As built (2026-08-15) — deltas from the design above

- **Import-review capture (path b): DECIDED AND BUILT** (2026-08-15, later the
  same day). Mason chose **tag-before-dropping**: a hover "that's crew" button
  on each review tile (`CrewFaceTag`, intel accounts only) saves the face —
  server fetches the frame's `fullUrl` (a 200px thumb makes a bad reference),
  downscales camera originals, runs detection — and then UNCHECKS the tile,
  because keeping the face is the reason the frame can go. The fetched URL is
  allowlisted to SPS hosts + R2 (SSRF). The confirmation prints beside the
  selection count that just moved.
- **The gallery-side entry is at CLUSTER level, not photo level** —
  `CrewLinkAction` ("crew…") in the PersonModal beside rename/split. Stronger
  than tagging one photo: the whole cluster's faces feed the matcher, and its
  representative face joins the references.
- **`/people` crew section defaults to REGULARS** — Mason's call, with the
  reason recorded: the page is "a sort of 'trophy room' so I think it will be
  fun to go there and see our colleagues first, not randoms. When we are
  trying to remember someone's name… it's easy enough to click non-regular."
- **Avatar crops are CSS windows, not stored crops** (the People view's
  FaceCrop math, generalised in `CrewAvatar` to measure uploaded images via
  onLoad since they have no stored dimensions). A reference whose pixels are
  gone stays matchable and stops being drawable — falls back to initials.
- **Confirm teaches:** `confirmCrewPerson` snapshots the cluster's
  representative face into `crew_faces` as `confirmed-suggestion`. Re-tagging
  the same face is a no-op by lookup, not by constraint.
- **Deleting the starred reference hands the star to the newest survivor** —
  a person with references must never silently fall back to initials.
- **Gating:** all routes via `getIntelUser()`; `CrewWall` and `CrewLinkAction`
  self-gate to nothing (403 → null render); the store scopes every query by
  `user_id` regardless.
