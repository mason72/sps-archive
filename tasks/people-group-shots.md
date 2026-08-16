# People: group shots on a person's card

**Status: COMPLETE (2026-08-16) — plumbing, face rings, identity merge, the
naming engine, and crew-first are all LIVE. Deferred: archive-wide conflation
cards (same-event cases already covered per event) and cross-event tile
fan-out (zero real cases today).**

## What Mason asked for

> "People's group shots should appear in their image card. That card is showing
> all photos that person is in, not JUST their solo images. In many cases, the
> group shots are the most interesting ones. Yes, those shots may show up in
> multiple people's cards, but THAT IS THE POINT."

So the card's meaning is **"photos this person is IN"**, and one frame appearing
on several cards is the feature working. It is not deduplication territory.

## The two membership questions

| Question | Answered by | Sees group shots? |
|---|---|---|
| Whose *shoot* is this frame from? | `personKeyForImage()` — filename | No |
| Who is *in* this frame? | `loadFaceMembership()` — named face clusters | Yes |

Both are single-homed on purpose. The `/people` tile counts, the spotlight card
renders, and the `?person=` deep link opens the event — all three read the same
two predicates. A second copy of either recreates the tile/card disagreement
that shipped as lesson 88.

## What was measured before building (2026-08-16)

`scripts/triage/group-shot-gain.ts`, whole archive, 39,282 images in scope:

- **7,592 photos hold 2+ detected faces** (group shots), containing **34,769 faces**.
- Of those faces: **1.9% belong to a NAMED cluster**, **80.3% to an ANONYMOUS
  one**, 17.8% unassigned.
- Novel person↔photo pairs face clustering knows and filenames don't: **356**.
- Of those, landing on an identity the index actually renders:
  **84 genuine group shots + 77 name-variant merges**.

**The blocker is naming, not plumbing.** Clusters are named only by filename
consensus (`cluster-event.ts`), so headshot days get named clusters — the same
photos the card already had — while the group-heavy galleries name nobody and
stay anonymous: WACA Holiday Party (1,067 group shots), Perkin Elmer (789),
Lafayette Art & Wine (608), Microsoft photo booth (583), weddings.

**The prize is the 27,919 grouped-but-unnamed faces.**

## What shipped

`src/lib/people/face-membership.ts` — `loadFaceMembership(supabase, eventIds)`
returns `personKey → Set<imageId>` from named clusters. Wired into both
`buildPeopleIndex` (tile) and `buildPersonDetail` (card).

Three invariants, each from real data:

1. **Contamination guard.** Two faces from one cluster in one photo means the
   cluster is wrong — a person appears once in a frame. Those pairs are DROPPED,
   never guessed at. Steven Hughes's cluster holds 203 faces across 184 photos,
   so ~19 frames carry two "Steven" faces and at most one is him. This path only
   ever ADDS photos, and a wrong add puts a stranger on someone's page.
2. **A group shot never becomes a card's hero.** The crop fronting a card must
   unambiguously be that person; a multi-face frame cannot promise that.
3. **Only VOUCHED identities are admitted** (the existing `looksLikePersonName`
   corpus check), or cluster names would import venues and banner text onto the
   people wall.

Performance: `loadFaceMembership`'s chunks run concurrently — serially they were
3.9s of a 5.0s `/people` build; now 1.0s of 2.3s.

Verification: `scripts/triage/verify-group-shots.ts` (tile == card for people who
gain group shots) and `scripts/triage/verify-people-counts.ts`.

## The face ring — BUILT 2026-08-16

Mason: *"add an outline box/circle on group shots when in the 'Is this
So-and-so' cards … so it's clear who we're identifying as the matched face."*

- `GET /api/people/[personId]/faces` — per-image bbox geometry for a cluster +
  which of its frames hold 2+ faces. Ownership-scoped like the PATCH beside it.
- `src/components/events/FaceOutline.tsx` — `usePersonFaces()` (best-effort:
  a failed fetch renders the modals exactly as before) and `FaceRings`, with
  TWO fit modes: `natural` (percentages map 1:1) and `cover-top` (bbox remapped
  through the `object-cover object-top` square crop — sides crop on landscape,
  bottom on portrait; a cropped-away face draws nothing). White ring, dark halo
  both edges — legible on any photo, deliberately NOT emerald (marks a face in
  a photograph, not app state).
- **Rings render only on frames with 2+ faces** — solo portraits stay clean.
- Wired into all four review surfaces. `SplitPersonModal` keys per-FACE, so a
  contaminated cluster's twin tiles of one group shot are tellable apart.
- Visual fixture: `/dev/face-rings` (NODE_ENV-gated) — real NASAI group shots,
  both orientations, both fits, verified by eye.

## The naming engine — BUILT 2026-08-16

Matches the ~4,500 anonymous clusters against 1,447 named-identity reference
centroids and writes SUGGESTIONS; a human confirms, always.

- **Storage** (migrations 065–067): `person_reference_centroids` (centroid per
  named cluster, excluded_people filtered, 2+ faces required) and
  `person_identity_suggestions` (one per cluster, `pending → confirmed |
  rejected | superseded`). pgvector RPCs `refresh_person_reference_centroids`
  (event-scoped for routine paths — the FULL rebuild cannot fit PostgREST's 8s
  budget and runs via `scripts/db-sql.ts`) and `match_person_cluster`.
- **The bar is measured, not chosen** (`identity-suggestions.ts`): hold-one-out
  over identities with 2+ named clusters — best WRONG match maxed 0.363 over
  48 trials, true matches median 0.886. Floor **0.55**.
- **The human's word is durable on both ends**: confirm writes `persons.name`
  (human-authored, consensus namer never overwrites) and refreshes that
  event's centroids — teach-on-confirm. Reject lands in
  `persons.rejected_names` — the engine can never re-ask.
- **Inngest `identity-scan`** fires after `face-cluster` (debounced 5m), so
  future imports self-suggest. Backfill: `scripts/scan-identity-suggestions.ts`
  (initial run wrote **50 pending** — 33 of them eBay interns at the eBay
  interns event; old 2014/15 galleries yield ~1 each since references don't
  reach back a decade).
- **UI**: the "Who is this?" tray on `/people` (`IdentitySuggestions.tsx`) —
  payoff-sorted, cluster face beside reference face (`FaceCircleCrop`, now the
  ONE home for crop geometry), renders nothing when empty.
- Traps encoded in migrations/commit: data-modifying CTEs share one snapshot
  (the refresh's DELETE was invisible to its INSERT → plpgsql); the backfill's
  candidate query silently capped at exactly 1,000 rows with WACA missing —
  **the tell for truncation is a round number**.

## Crew-first — BUILT 2026-08-16

Mason, on Staff Photos' garbled names: *"before we try to create a new face,
shouldn't we look for Crew and ask 'is this Christie?' before we ask if it's
'Marriott Green'?"* Structurally necessary, not just polite: crew barely exist
in filenames — Mason is the only crew member with a filename identity (9
events), Joey/Justin/Jerrick hold ZERO, which is also why Mason alone reached
the old wall of fame.

- The scan matches every anonymous cluster against `crew_faces` snapshots
  FIRST (`match_person_cluster_to_crew`, migration 069 — best face per crew is
  the evidence), falling through to guest identities only on a miss.
- **A crew confirm is a `crew_persons` LINK via `confirmCrewPerson` (which
  teaches), never a `persons.name` write** — the crew-faces invariant holds
  the whole way down. Crew-linked clusters are skipped entirely.
- First crew-first scan: **37 crew suggestions across 20 crew** — Justin's
  Staff Photos cluster at 341 photos, Christie at 77 ("is this Christie?"
  verbatim), Jerrick 0.916, Joey 0.856.
- Wall of fame: crew excluded from the podium (they stay in Everyone), top 6
  in two rows. After Mason's 51 confirms the podium is all repeat GUESTS —
  Sophia Carazo-Ortiz, Jenna Kazim, Aleta Cruel, Edward Jue, Adithri Sharma,
  Brittany Reed — which is what a trophy shelf should mean.

## Shared-name conflations — measured, groundwork laid, cards NOT built

The centroid detector (2026-08-16) found **17 flagged names**, and every
real-person case is SAME-EVENT (two "Cooper Scott" clusters at NASAI scoring
0.057 against each other) — the cross-event John Smith case has ZERO instances
today. Same-event collisions are already surfaced by the event People view's
merge/split cards, so the archive-wide card surface was deferred; migration
068 carries `person_split_dismissals` ready for it. The detector also caught
reference pollution (marketing-gallery clusters as naming references) — fixed
via the excluded-gallery param on the refresh.

## NOT built — next session

1. **Archive-wide conflation cards** — surface the 17 flagged shared-name
   pairs in one place (faces side by side, rename-a-side / same-person /
   open-event), instead of leaving them to be stumbled on per event.
   `person_split_dismissals` (068) is the durable "same person" memory.
2. **True tile fan-out for cross-event shared names** — deferred until a real
   case exists; the archive currently has none.

## The identity merge — BUILT 2026-08-16

"Sami Hadouaj" / "Sami Hadouaj Mundra": one human, two tiles, because /people
identity is the normalized filename name and no corpus proves two spellings are
one person — only a human can. `person_aliases` (migration 064) records the
judgement; `src/lib/people/aliases.ts` is the ONE resolver, applied at every
identity decision point: the index's filename pass, its face-membership pass,
the detail card (ilike candidate filter ORs across every spelling's token), and
the event `?person=` deep link (`GET /api/people/aliases` for the key group).
Two of four folding and two not is the tile/card disagreement of lesson 88.

- **Human-initiated only.** Two John Smiths are already one tile; no automatic
  signal can safely merge or split a name.
- UI: spotlight "Same person as…" → search → confirm on FACES side by side.
  Merges stay visible ("also filed as …" + per-spelling unmerge); undo bar
  after each merge. Chains flatten at write; cycles refused; resolver follows
  chains defensively anyway.
- Proof: `scripts/triage/verify-alias-merge.ts` — merged tile equals the UNION
  of the two cards (not the sum: face membership had already unified Sami's
  photo sets, which the first assertion got wrong), card agrees from either
  spelling, temporary row removed after.

## Resolved

- **Steven Hughes's bad rows** (2026-08-16, Mason: "delete all four", gated on
  byte-identity). THE GATE FIRED: `DAIS_3409 1/2.jpg` share a byte count
  (1,220,406) and dimensions but differ in sha256 AND decoded pixel hash —
  a burst pair from the same second, not copies. Both kept. The three 31×25
  thumbnails (`DAIS_3402 9/10/11.jpg`) were deleted through the app's own
  delete semantics (locked-section guard, cascade, `deleteImageAssets`),
  verified 0 rows remaining. His honest count: **184**. Script:
  `scripts/triage/delete-steven-bad-rows.ts`. The lesson: **matching byte
  count + dimensions is strong evidence and still not identity** — the cheap
  hash is what separates a burst from a dupe.
