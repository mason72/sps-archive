/**
 * The SimplePhotoShare → Pixeltrunk contract.
 *
 * **One direction only** (Mason, 2026-08-11: "this can be a 1-way door. I don't
 * anticipate a need to maintain any parity between events on the two systems").
 * Pixeltrunk pulls a finished event's camera files; SPS is never told what the
 * archive did with them afterwards. Sections, stacks, tags, focal points and
 * every other curation decision live here and stay here.
 *
 * The protocol types live in `pull-client.ts`, next to the only code that speaks
 * it. Contract: `tasks/sps-archive-pull-spec.md`.
 *
 * Two things this file used to describe, both now deleted:
 *
 *  - **A PUSH import** ("SPS sends event + image metadata, the archive mints rows
 *    pointing at the same R2 keys"), premised on a shared bucket. There is no
 *    shared bucket — SPS serves `pub-7363d57d….r2.dev`, the archive stores
 *    `sps-prism` — so those types described an import that could only ever
 *    produce unreadable tiles.
 *  - **An enhancements RETURN LEG** (`ArchiveEnhancements`, `generateEnhancements`,
 *    `GET /api/sps/enhancements/[eventId]`), which sent AI sections and stacks
 *    back for SPS to display. Nothing in the SPS family ever called it —
 *    verified by grep across every app, package, tool and sibling repo — and it
 *    was the only parity machinery, so the one-way-door decision retired it.
 *    Its removal also empties the middleware's public `/api/sps` exception list:
 *    every remaining route under `/api/sps` is photographer-facing and sits
 *    behind the session.
 *
 * What survives the one-way door is the LINK, not parity:
 * `events.settings.spsEventId` (see `event-link.ts`) and the per-photo
 * `images.sps_image_id`. Those are provenance — they answer "where did this come
 * from", make "already imported" exact rather than a name guess, and let the
 * guest-list flow resolve an event without matching on names. A pulled event
 * arrives already carrying the foreign id, which is precisely why nothing ever
 * has to guess.
 */

export {};
