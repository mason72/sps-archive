# People: group shots on a person's card

**Status: plumbing LIVE (2026-08-16). The naming engine that makes it pay off is NOT built.**

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

## NOT built — next session

1. **The face outline on confirm cards.** Mason, 2026-08-16: *"We may also want
   to add an outline box/circle on group shots when in the 'Is this So-and-so'
   cards to confirm merging or keeping separate so it's clear who we're
   identifying as the matched face."* Essential once group shots are in play —
   a confirm card showing a 6-person photo without marking WHICH face is being
   claimed is asking for a blind yes. The data exists: `faces.bbox_x/y/w/h` plus
   `images.width/height`, already carried through `FaceRef` in
   `src/lib/faces/people-data.ts` (`personImageFace` maps `personId:imageId` →
   the exact face). This is a rendering change, not a data one.
2. **The naming engine** — the actual payoff. Use the ~1,440 identities already
   named from headshot days as reference faces and match them against the
   anonymous clusters, so the party/festival/conference galleries gain names.
   The machinery exists: `findCrewInArchive()` / `matchSelfie()` from
   `tasks/crew-faces.md`, generalised from crew to guests. AI suggests, a human
   confirms — never auto-applied.
3. **Duplicate identities from name variants.** "Sami Hadouaj" and "Sami Hadouaj
   Mundra" are two tiles for one human, and face membership now gives them
   overlapping photos. Each tile is more complete than before; the duplicate
   identity itself remains. Needs a merge affordance on the people wall.
4. **Steven Hughes's four bad rows** (awaiting Mason's OK): one true duplicate
   pair (`DAIS_3409 1.jpg` / `DAIS_3409 2.jpg`, identical size and dimensions)
   and three 31×25-pixel junk rows (`DAIS_3402 9/10/11.jpg`). His honest count
   is ~183 of 187.
