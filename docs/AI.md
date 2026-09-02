# The AI System (v2, shipped 2026-08-09/10)

Everything AI in Pixeltrunk, end to end. The v1 pipeline never deployed and was
deleted; this is a from-scratch rebuild. History/verification detail:
`tasks/todo.md` ("AI revival" sections); field lessons: `tasks/lessons.md` 43+.

## The one invariant that matters

**AI never writes anything the upload or display path reads.** Not
`processing_status`, not `thumbnail_generated`, nothing. AI owns:
`siglip_embedding`, `embedding_model`, `ai_indexed_at`, `aesthetic_score`,
`sharpness_score`, `faces` rows, `persons` rows, `focal_x/y` (fill-nulls-only).
If every AI job dies, galleries are byte-for-byte unaffected. Kill switch:
`AI_INDEXING_ENABLED` (Vercel env; off = pre-AI behavior).

Second invariant: **AI suggests, humans apply.** Sections, names, merges,
splits, mislabel fixes — everything routes through a preview/card the
photographer clicks. Nothing reorganizes anything autonomously (the v1
pipeline's fatal sin).

## Compute: Modal app `sps-archive-ai` (modal/ai_pipeline.py)

- `index_images` (GPU, T4): batches ≤100 presigned thumb-lg URLs → SigLIP-2
  so400m image embeddings (1152-dim), ArcFace buffalo_l face boxes + 512-dim
  embeddings, aesthetic-predictor-v2.5 + Laplacian sharpness. Weights baked at
  image build; `pipeline_key` auth (shares VIDEO_PIPELINE_KEY); pure compute —
  no storage/DB credentials, persistence happens in Next.js.
- `embed_text` (CPU, 6GB — Gemma vocab is 1.2GB): search/scene queries never
  wait on a GPU. ~1s warm, ~15-20s cold (UI shows a "warming up" hint).
- `embed_selfie` (GPU class method): guest selfie → embedding IN MEMORY, never
  stored anywhere. Also the crew-face tag path. **Cold start is the whole
  latency**: measured 23–44s cold vs 0.6–1.4s warm (`usage_events`, kind
  `ai_embed_selfie`). The class now idles **600s** before reclaim (was 120s;
  ~8¢ of idle T4 per burst at most), and `POST /api/crew/faces/warm` wakes it —
  the import review fires that on open so the load overlaps the scrolling.
  A ~30s `ai_embed_selfie` row with no faces is the warm ping, not a slow tag.
- Deploy: `~/.venvs/modal-cli/bin/modal deploy modal/ai_pipeline.py`.
- Gotcha: fixed-res SigLIP-2 checkpoints are `model_type: siglip` — use
  `AutoImageProcessor`/`AutoTokenizer`/`SiglipTextModel`, never `AutoProcessor`
  (hardcodes a sentencepiece tokenizer that crashes). Lesson 43.

## Indexing lane (settlement-triggered, never in an upload path)

`/api/upload/complete` fire-and-forgets `ai/index.requested` → Inngest
`ai-index` (2m/event debounce + zero-pending-uploads check + kill switch) →
`src/lib/ai-index/index-event.ts` batches → Modal → writes AI columns + faces
(replace-per-image, idempotent; focal_x/y untouched). Completion fires
`faces/cluster.requested`. Nightly reconciler sweeps events with unindexed
work (catches SPS imports). Backfill/ops: `scripts/backfill-ai-index.ts`
(~1 img/s, T4 ≈ $0.60/hr; the 19.6k archive cost ~$5).

**Face rows insert 50 at a time (`FACE_INSERT_CHUNK`), and the number is
measured, not chosen.** `faces` carries an HNSW index on the binary-quantized
embedding, so every inserted row is woven into that graph at a per-row cost that
climbs as the graph grows — a fixed batch size is therefore on a clock even
though no code changes. Writing a whole 100-image batch as one statement lost to
PostgREST's 8s `statement_timeout` four times (57014: 2026-08-12 at 02:30 and
04:10 UTC, 08-29 and 08-30 at 09:47).

**The failure is an EXCURSION, not a volume problem — do not re-derive it as a
density story.** The four failing events run 1.0, 1.0, 2.0 and 3.2 faces per
image (DAIS 26, Island HQ Headshot Day, Power Rangers, Ivana's Bridal Shower):
headshot days, not group shots. Their failing statements were ~100-320 rows,
which warm costs ~0.2-0.7s against an 8s ceiling — so something >10x slow did
it, not the row count. Measured on the live index, warm cost is flatly linear at
~2.1ms/row (50 rows 107ms, 150 rows 360ms), but one cold first-write ran 8,606ms
for 150 rows. Chunking works because the timeout is PER STATEMENT: less work per
statement moves the same excursion under the ceiling. The archive DOES reach 9.7
faces/image on some galleries (one frame holds 129) and those batches really are
~1,000 rows — but none of them is what failed.

Ordering makes a mid-chunk failure safe: `ai_indexed_at` is written LAST, so a
throw leaves the batch unindexed and the retry's `faces delete` wipes what
landed. **Never chunk a write here that is not ordered that way** — it turns one
atomic statement into a partial commit.

`recordUsage` fires BEFORE the faces write, so a failure anywhere after Modal
bills a GPU pass that is then thrown away and redone. That is correct (the GPU
time was genuinely spent) but it means a write that reliably fails costs real
money on every retry and every nightly sweep, not just once.

## Search

- RPCs (`search_images_by_embedding`, `search_faces_by_embedding`,
  `score_images_by_embedding`) all REQUIRE `target_user_id` — ownership can't
  be forgotten (the getAuthUser IDOR class) — and gate on
  `thumbnail_generated`, never legacy `processing_status`.
- Thresholds are ADAPTIVE, not constants (`src/lib/ai-index/search-filter.ts`):
  keep matches within 60% of the top score, floor 0.04. SigLIP cosines are
  small (real matches 0.05-0.16) and overlap nonsense ranges; fixed constants
  hide real results. Lesson: calibrate on the biggest corpus you have.
- Surfaces: `/search` (archive-wide, auto mode: filename hits win, else
  semantic), editor in-event box (same fallback, event-scoped), guest gallery
  search (`/api/gallery/[slug]/search`, ids-only responses resolved against
  the share's visible payload — layered leak-proofing; per-event `guestSearch`
  toggle default ON), guest selfie search (`selfie-search`, default **ON**
  since 2026-08-10 — the selfie is embedded in memory and never stored, so
  there is nothing retained to be cautious about; face hits vote for a PERSON,
  winner's complete set returns — sunglasses-proof recall).
  Read the flag ONLY via `selfieSearchEnabled()` (`src/types/event-settings.ts`):
  absent means on, and only an explicit `false` opts out. A `=== true` read
  would have left every pre-existing event dark forever, since events store
  `{}` and the defaults live entirely at read time.

### Names first, then the AI — on BOTH sides (2026-08-21)

Every search surface that has filenames matches them first and only then
asks the model. The guest search box always did (filename/parsed-name
contains, AI fallback when that finds nothing); the Smart section modal was
AI-only, so "group" returned 14 there and 36 for a guest, and Justin asked
whether the two were the same engine. They are — `type=semantic` on
`/api/search` — the inputs differed. The modal now unions `type=filename`
(leading, tagged "name") with `type=semantic`, and the header counts each.

Why the AI alone found 14 of 36: `filterSemanticMatches` keeps matches within
60% of the TOP score (a fixed threshold was measured wrong both ways on
2026-08-10). "group" is a weak query for SigLIP — top 0.115 vs 0.16 for
"several people posing together" — and to the model "group" means a crowd:
the 20-person frame leads, four-person rows sit mid-pack, two people together
barely register, so the 60% cut at 0.069 dropped every two-person frame.
Describe the scene ("people posing together"), not the category noun. The
modal's example chips say so.

### "Group" is a face count, not a concept (2026-08-21)

Mason: "can we cheat the index and let it recognize a group as any image with
2+ faces?" Yes — the detector already counted. `count_faces_by_image(event)`
(migration 071) returns faces per frame; `src/lib/ai-index/face-count-query.ts`
holds the vocabulary (`group`/`together`/`team` = 2+, `two people`/`pair`/
`couple` = exactly 2, `crowd`/`everyone`/`whole team` = 5+). Both search routes
apply it: the guest route answers structural words from counts and never
embeds them; `/api/search?type=faces` serves the Smart section modal, which
unions name → faces → AI and tags each. Measured on Appfolio: 2+ faces = 42
frames = all 36 group files + 5 Kaitlin-with-dog (the detector's dog face) + 1.
No quality floor on purpose: small faces in a 20-person frame score low too,
and losing the crowd is worse than one dog the modal lets you click away.

## Faces suite (src/lib/faces/)

- `clustering-core.ts` (pure) + `cluster-event.ts` (DB): incremental,
  name-preserving clustering; never merges existing persons (splits are
  durable by construction); consensus auto-naming from filenames (≥80%
  dominance, ≥2 files, person-like — junk filenames stay blank);
  representative face prefers SOLO-portrait faces (group-photo reps can show
  the wrong person). Inngest `face-cluster` after indexing; ops:
  `scripts/cluster-all-events.ts`.
  **A human clearing a name is durable** (migration 063): the cleared name
  lands in `persons.rejected_names` and `nameIsRejected()` blocks the
  consensus namer from re-applying it (letters-only compare, so spelling
  variants stay rejected). Without this, a cleared name was a null and nulls
  get refilled — the human's "this filename is wrong" undid itself every
  clustering run (seen live: a stranger's photos exported under "Jenna
  Wombles"'s filename). Typing a name un-rejects it; rejection gates only the
  automatic path. Proof harness: `scripts/triage/verify-rejected-name.ts`.
- `suggestions.ts` (pure) + `people-data.ts` (assembly) + people routes: the
  identity-correction engine. Card types: mislabel (SOLO portraits only —
  group photos would ping-pong renames; grouped per person+label),
  refine-name (fuller filename form; names get truncated, not invented),
  merge (same-name clusters; per-side rename in the review modal for the
  "two people share a misfiled name" case), split (two strong non-family
  filename camps — also exactly the consensus-blocked unnamed population).
  `sameNameFamily`: word-boundary prefix = agreement, never conflict.
  Dismissals persist in `events.settings.people.dismissedSuggestions`.
- `split.ts`: filename-seeded proposals, 2-means face fallback with a
  minority guard (≥ max(2, 10%) — a 34-vs-1 "split" is an outlier, not a
  person). Splits move FACES, not photos (shared frames belong to both).
- UI: PeopleView (circle crops, A-Z + Unnamed groups, badge on the toolbar
  Users button, search filters by matching-photo membership) + modals
  (compare/person/split/merge — all with Filenames toggles; filenames are the
  identity evidence).

## Sections

- "By scene" mode in SortSectionsModal: taxonomies live in CODE
  (`scene-taxonomies.ts` — editing costs nothing, nothing persisted at
  ingest), scored at suggest time via `score_images_by_embedding` (exact scan,
  paged past PostgREST's 1000-row cap), assigned with per-label event-mean
  DEBIASING (raw argmax let "Portraits" swallow 96% of a wedding),
  multi-membership by margin, "Everything Else" catch-all guarantees full
  coverage (required: apply consumes the Unsorted intake). Applies through
  the unchanged auto-sections contract (is_auto wipe, additive, manual
  sections untouchable).
- Smart section (additive): describe → event-scoped semantic search → curate
  → Copy (adds membership) or Move (also strips others) — memberships are
  references, never file copies. `is_auto: false`, so rebuilds never eat it.

## Focal points

`computeAutoFocal` (src/lib/site/focal.ts): one confident face → eye-level
anchor; SEVERAL → union-box center x, mean eye level y (groups, since
2026-08-10); zero → null. `ensureAutoFocal` uses stored faces rows wherever
they exist (indexed images = pure arithmetic, zero Modal); the CPU detector
(`modal/face_pipeline.py`) survives only for the minutes-old upload window.
Fill-nulls-only, always.

## Env vars

`MODAL_AI_INDEX_URL`, `MODAL_AI_EMBED_TEXT_URL`, `MODAL_AI_SELFIE_URL`,
`AI_INDEXING_ENABLED`, `VIDEO_PIPELINE_KEY` (shared pipeline auth). Set in
Vercel prod + `.env.local`. Env changes apply on next deploy only.

## Verification scripts (all read-only or self-restoring unless noted)

`verify-ai-pipeline.ts` (Modal contract + retrieval), `verify-semantic-search.ts`
(query → RPC, threshold calibration), `verify-face-clustering.ts` (purity vs
filename ground truth; --reset is destructive), `verify-people-suggestions.ts`,
`verify-split-proposal.ts`, `verify-scene-plan.ts`, `verify-selfie-search.ts`,
`verify-smart-section.ts`, backfills: `backfill-ai-index.ts`,
`cluster-all-events.ts`, `backfill-group-focals.ts`.
