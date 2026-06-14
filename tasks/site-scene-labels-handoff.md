# Site scene labels — data handoff (from the TDP Website session)

**Purpose.** Populate the two registry fields that drive position-aware badges
in the curation editor, sourced from the live website's page copy + layout:

- `SceneDef.positionLabels?: string[]` — for **ordered** scenes (image N → tile
  N). Index 0 = drag position 1. Editor shows the label instead of a bare number.
- `SceneDef.pinned?: number` — the always-shown fixed prefix (first N by drag
  order always render; the rest rotate/sample).

Both already exist in `src/lib/site/scenes.ts` with doc comments saying
"populate from the TDP Website session." This is that data. All of it is
verified against the website repo (`tdp-website`): labels from page copy,
pinned counts from the actual `samplePool(pool, size, lead)` call sites.

---

## 1. Ordered scenes → `positionLabels`

```ts
"benefits/headshot-booth":   ["Instant delivery", "Zero retouching", "Endless traffic", "Lead capture", "Scales to 10+ teams", "Branded to your event"],
"benefits/photo-booth":      ["Real photographers", "Studio lighting", "80+ backdrops", "Props that land", "Instant sharing", "Hosted gallery"],
"benefits/anti-booth":       ["The venue is the set", "Editorial lighting", "Never recreated", "Any light, any hour", "Instant sharing", "Gallery included"],
"benefits/event-photography":["Conferences & expos", "Activations & launches", "Stadiums to boardrooms", "Fast turnaround", "Teams that scale", "Personality included"],
"benefits/video":            ["Event recaps", "Behind the scenes", "Brand content", "Social-first cuts", "Same crew, same bar", "Fast delivery"],
"benefits/office-headshots": ["Real people, real best", "Done by lunch", "12–20 per hour", "A standing cadence", "One consistent look", "Three home regions"],
"benefits/drop-in-sessions": ["Your session, your pace", "Multiple looks", "Finished fast", "Retouching, optional", "The Studio WC", "Bring a friend"],
"story":                     ["Crew on location", "Behind the scenes", "On-site headshots"],
"about-values":              ["People first", "No shortcuts", "Keep it fun", "Easy to work with"],
"quote":                     ["Headshot booth (main)", "Event portrait (inset)"],
"portrait/styles":           ["Traditional", "Editorial B&W", "Environmental"],
"portrait/categories":       ["White (Super White)", "Light gray", "Dark", "Color", "Gels"],
"portrait/finishing":        ["Posing", "H&MU", "AI Retouch", "Lighting boost", "Posing table", "Close-up"],
```

**Two labels are inferred, not authoritative — confirm with Mason before trusting:**
- `story` (3) and `quote` (2) were derived from image alt text; the code has no
  real names. If those crew photos are specific people, name them.

---

## 2. Pinned prefixes → `pinned`

The pinning lives on the **rotating `slot` scenes**, not the pools. Verified:

```ts
// 7 service-page hero carousels — samplePool(heroFrames, 20, 4)
"slot/hero/headshot-booth":  pinned 4,
"slot/hero/photo-booth":     pinned 4,
"slot/hero/anti-booth":      pinned 4,
"slot/hero/event-photography":pinned 4,
"slot/hero/video":           pinned 4,
"slot/hero/office-headshots":pinned 4,
"slot/hero/drop-in-sessions":pinned 4,

// 6 homepage "What we do" cards — samplePool(pools[i], 12, 1)
"slot/slice-1": pinned 1,
"slot/slice-2": pinned 1,
"slot/slice-3": pinned 1,
"slot/slice-4": pinned 1,
"slot/slice-5": pinned 1,
"slot/slice-6": pinned 1,
```

**All true `pool` scenes pin 0** (fully rotating — drawn from up to 20–24, the
layout shows its tile count, nothing fixed): `hero`, `featured-work`,
`service/photo-booth`, `service/anti-booth`, `service/video`,
`service/environmental-portraits`, `photo-booth/overhead`, `photo-booth/bw-glam`,
`photo-booth/custom-sets`, `photo-booth/step-and-repeat`, `ai-examples`,
`bts/headshot-booth`, `bts/photo-booth`, `bts/anti-booth`, `drop-in/actors`,
`samples/headshots`.

### ⚠️ One decision before wiring `pinned`
The field's doc comment scopes it to **`pool`** scenes, but every real pin is on
a **`rotates` slot** (the heroes pin 4, the slices pin 1). So either:
- (a) extend `pinned` to apply to `rotates` slots too (read it wherever a
  rotating set is drawn), or
- (b) keep `pinned` pool-only and add the badge logic for rotating slots
  separately.

(a) is simpler and matches reality — there are currently **no** pinned pools, so
nothing breaks. Recommend (a).

### Call-site references (in `tdp-website`, for verification)
- `src/components/services/ServicePage.tsx:442` — `samplePool(heroFrames, 20, 4)` (hero carousels)
- `src/components/home/Services.tsx:95` — `samplePool(pools[i], 12, 1)` (slice cards)
- `src/components/services/ServicePage.tsx:333` — `samplePool(pool, 20)` (section galleries, lead 0)
- `src/components/services/ServicePage.tsx:587` — `samplePool(heroFrames, 24)` (BTS mosaic, lead 0)

---

## Suggested apply

Add `positionLabels` / `pinned` to the matching entries in
`src/lib/site/scenes.ts`. No migration — these are static registry fields the
editor reads. Keep them in sync with the website's page copy (the source of
truth for the labels is the `tdp-website` repo).
