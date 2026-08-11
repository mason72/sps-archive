# Blind highlights test — Foot Locker event

**Event:** Jordan x Kids Foot Locker // Back to School // NYC
(`e8459f76-1212-461e-9078-cdc6e945e68c`) — 679 files, 397 expected moments.

**Protocol:** I pick my set without seeing Joey's. Mason holds his picks until
mine are committed to this file. Reason (Mason, 2026-08-11): seeing his first
would let me fit this one event and learn nothing that generalizes — the same
reason the eval harness must hold an event out.

## Method, declared before viewing any frame

1. Group the 679 files into moments — SigLIP cosine + capture-time proximity.
   Branded twins (identical `taken_at`) and burst frames collapse to one moment.
2. Build labelled contact sheets, one representative frame per moment.
3. **Pass 1** — fast cull across all sheets → shortlist.
4. **Pass 2** — view the shortlist larger, rank it, cut to final.
5. Commit picks here, then compare.

**Target count:** ~20 finals (the ~5% median ratio measured across the 12 events
that already have hand-picked Highlights), plus a ranked top-40 so precision can
be measured at whatever count Joey actually used. Ranking the list rather than
fixing a count keeps the comparison honest regardless of how many he picked.

## Criteria, declared before viewing any frame

In priority order:

1. **Expression and energy** — a genuine reaction beats a held pose. At a kids'
   activation this is most of the job.
2. **Subject clarity** — one unambiguous subject; the eye should not have to
   hunt for who the photo is about.
3. **Composition** — framing, headroom, background that doesn't fight the
   subject.
4. **Technical floor** — focus on the eyes, no motion blur on the face, exposure
   that holds detail. A floor to clear, not a thing to optimize.
5. **Coverage** — across subjects and across the event timeline. No more than a
   couple of finals from any one subject, however good they are.

**Explicitly NOT used:** `aesthetic_score`, `sharpness_score`, `is_eyes_open` —
all three were measured against 742 real human picks earlier today and none of
them separate picks from rejects (`is_eyes_open` is `true` on all 33,406 face
rows and is simply broken). Using them would import a known-bad prior.

## Criteria amendment (declared after pass 1, before picking)

Two criteria I did NOT anticipate and am adding openly rather than pretending
they were always there:

6. **Campaign relevance** — this is a brand activation, so frames carrying the
   story (backpacks, sneakers, the handwritten "Back 2 School!" signs) are worth
   more to the client than an equally pretty frame that carries nothing.
7. **Rhythm** — a reel of 20 identical head-on portraits is monotonous. A couple
   of product/detail frames and one wide frame earn their place by breaking it.

This is itself a finding: **highlight criteria are event-type dependent.** What
makes a highlight at a brand activation is not what makes one at a wedding, and
a single global model cannot know which it is looking at.

## Method actually run

- 679 files → **358 moments** by exact `taken_at`. Embedding similarity was
  measured and **rejected** for grouping: consecutive-pair cosine median is
  0.915 while the known branded twins sit at 0.918 — on a fixed-backdrop shoot
  SigLIP encodes the *set*, so near-duplicates are statistically invisible.
  Capture time separates them exactly.
- Pass 1: 15 contact sheets, all 358 moments → 60 shortlisted.
- Pass 2: 4 sheets at 400px → ranked 40, top 20 are the finals.
- Coverage enforced by hand: at most one moment per subject group.

## My picks — committed 2026-08-11, before seeing Joey's

Full ranked list with image IDs:
`scripts/triage/data/claude-picks-e8459f76-1212-461e-9078-cdc6e945e68c.json`

**Finals (top 20, in rank order)** — moment index, then what it is:

| # | Moment | Frame |
| --- | --- | --- |
| 1 | 36 | Two girls mid-air, fully extended. The most alive frame in the event. |
| 2 | 114 | Small boy holding a Jordan backpack, enormous grin. Joy and product in one. |
| 3 | 42 | Three-tier shoe-stack pose. The most inventive setup of the day. |
| 4 | 306 | Two kids hugging, both beaming. |
| 5 | 97 | Boy wearing sneakers as headphones. |
| 6 | 342 | Toddler in "Main Character Energy" tee, radiant. |
| 7 | 190 | Girl in pink with beaded braids, mid-laugh. |
| 8 | 262 | Girl holding beaded lanyards overhead, arms up. |
| 9 | 286 | Girl in SWISH jersey, sneaker balanced on her head. |
| 10 | 326 | Kid kicking a leg up, Jordan on the foot. |
| 11 | 298 | Toddler in profile, tan romper. Quiet frame, breaks the rhythm. |
| 12 | 316 | Boy in beaded necklace, huge grin. |
| 13 | 23 | Woman carrying a girl in sunglasses, both laughing. |
| 14 | 265 | Mother and daughter in traditional Ecuadorian dress. |
| 15 | 256 | Girl holding the handwritten "Back 2 School!" sign. |
| 16 | 47 | Two girls dancing, real motion. |
| 17 | 2 | Girl in the "Hoops Lives Here" tee, hand on hip. |
| 18 | 288 | Pink Jordans, product hero frame. |
| 19 | 112 | Girl and her grandmother. |
| 20 | 81 | Sneakers flying through the air over a group. Wide frame. |

**Extended ranking (21–40)**, so precision can be measured at whatever count
Joey used: 6, 12, 343, 321, 328, 59, 49, 230, 271, 86, 173, 16, 312, 142, 102,
32, 67, 122, 242, 352.

40 moments = 81 of the 679 files. Top 20 = 5.6% of moments, in line with the
~5% median measured across the 12 events that already have hand-picked
Highlights.

**Published to the event's Highlights section 2026-08-11**: 40 rows,
`sort_order` 1–40 by rank, `relevance_score` carrying the rank as a 0–1 score.
One frame per moment. Treatment balance fell out naturally even — 19 All Star,
18 She's Got Game, 3 landscape — so no rebalancing was applied. Verified:
40 rows, 0 unrenderable, 0 duplicate images, sort_order unique 1–40.
To undo: `DELETE FROM section_images WHERE section_id = '8ef0db1c-…'`.

---

# My notes

## What I was actually selecting for

A photobooth activation produces one dominant frame type: a person or group,
centred, against a fixed pink backdrop, looking at the lens. Roughly 300 of the
358 moments are that shot. Once the technical floor is met — and it almost
always is here, the lighting is consistent and the focus is reliable — the only
thing separating one frame from another is **what the subject is doing with
their face and body**. So that is what I ranked on.

I sorted the event into four bands:

1. **Something is happening** — mid-air, mid-laugh, mid-motion, or an invented
   pose. Rare, and almost the whole top 10.
2. **Genuine expression, static body** — a real smile rather than a held one.
   The bulk of the 11–40 range.
3. **Competent and blank** — correctly exposed, pleasant, nothing occurring.
   The largest band by far, and none of it made the list.
4. **Rejects** — blinks, awkward transitions, subject looking off-camera by
   accident.

The gap between band 2 and band 3 is where a photographer's judgment lives, and
it is invisible to every scalar we compute.

## Deliberate exclusions

- **Staff frames.** About a third of this event is Foot Locker crew in referee
  stripes, often goofing for the camera, and some of it is genuinely good
  (moment 159, two staff carrying each other, made me laugh). I took none in the
  top 20 and one team photo at rank 40. My reasoning: a highlights reel for a
  brand activation should show the activation working on its audience. If the
  client's actual ask is internal-culture content, I have this badly wrong, and
  it is the single largest systematic difference I expect against Joey.
- **Second frames of the same subject.** I held to one moment per subject group.
  Several subjects had two or three frames I would happily have taken — the girl
  in pink (190/191/192), the toddler in the navy tee (342/343), the boy with the
  beaded necklace (316/321). Coverage cost me those.
- **Near-identical poses across different subjects.** Six or seven back-to-back
  arms-crossed pairs were shot. I took none: the pose photographs well but the
  reel only needs it once, and none was clearly the best.

## Calls I would defend

- **36 at number one.** Two girls fully extended in mid-air, both faces visible,
  both genuinely delighted. Nothing else in 679 files is that alive.
- **42 (the shoe stack) at three.** Three people stacked vertically, each
  balancing sneakers. It is the only frame that could not have been taken at any
  other activation.
- **Including two product frames (288, 173) and one detail (163 at 40).** A reel
  of twenty faces is monotonous regardless of how good the faces are.
- **265, the mother and daughter in traditional Ecuadorian dress.** The most
  distinctive portrait of the day and the only frame that says anything about
  who came to this event.

## Calls I am not confident about

- **298, the toddler in profile, at eleven.** Quiet, soft, lovely light — and
  completely against the grain of everything else in the reel. It is either the
  best frame in the set or an indulgence.
- **The ranking within 5–15 is soft.** I could reorder those ten almost
  arbitrarily and defend the result. Precision at 20 is meaningful; the ordering
  inside it is not.
- **81 (sneakers thrown in the air) at twenty.** Chaotic and slightly messy. I
  kept it for frame variety, not because the photograph is strong.
- **How many landscape frames belong.** I took three of 115. Joey separated
  "Landscape (Clean)" into its own section deliberately, which suggests he
  thinks about them as a distinct deliverable, and I may have under-served them.

## What I want from Joey's notes

1. **Do staff frames belong in highlights for this client?** Biggest single
   assumption I made.
2. **When he picks two frames of one subject, what makes the second one earn its
   place?** My one-per-subject rule is the part of my method with the least
   evidence behind it.
3. **Which of my picks would he cut, and is the reason "not a good photograph"
   or "not a highlight"?** Those are different failures and they imply different
   fixes in the product.
4. **Did he pick a specific brand treatment per moment, or does he consider the
   twins interchangeable?** This decides whether the feature picks one, both, or
   asks.
