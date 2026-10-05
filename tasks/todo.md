# Auto-match: the identity engine confirms its own sure matches (2026-10-04)

Mason's decision (card, 2026-10-04): auto-confirm at 0.70 with a review strip.
Data behind it: 869 confirmed / 7 rejected; every rejection scored 0.55–0.58;
nothing above 0.58 ever rejected; 0.70 would have handled 88% of past confirms.

- [x] 0. Measure the margin guard: nearest OTHER identity for every confirmed cluster
      (`scripts/triage/auto-confirm-margin.ts`, read-only). Pick AUTO_MARGIN from data.
- [x] 1. Migration 094: `decided_by text` ('human'|'auto'), `reviewed_at timestamptz`,
      partial index for the strip; backfill decided rows as 'human'.
- [x] 2. Extract `decideOne` + `teachEvent` from the route into `src/lib/people/identity-decide.ts`
      (one confirm path; add `decidedBy`). Route imports it. Add `undo` for auto rows.
- [x] 3. Pure `decideAutoConfirm()` in identity-suggestions.ts + tests: unnamed cluster,
      sim ≥ AUTO_CONFIDENCE, runner-up of a different identity ≤ sim − AUTO_MARGIN.
- [x] 4. Scan: after upserting a pending row that qualifies, confirm it via decideOne
      (teach:false, decidedBy:'auto'); teach once per event; refresh index once; report `autoConfirmed`.
- [x] 5. UI: "Auto-matched · Review" strip on /people — faces, name, event, confidence;
      "Looks right" (single + all) sets reviewed_at; "Undo" reverts (guest: name→null + rejected;
      crew: unlink) and refreshes the wall.
- [x] 6. Docs: AI.md invariant amended (why, by whom, the guards), GOTCHAS line, CLAUDE.md
      one-liner, memory file, lessons entry. Erin/Phil follow-up noted.
- [x] 7. Verify: vitest, tsc, build in worktree; live-event gate; push; watch deploy;
      trigger a real scan; see the strip populate; undo one; confirm the wall.

## Follow-ups (not this build)
- Mislabel detector ignores crew-linked clusters: Erin Curdie's 6 frames sat under
  Phil Clarke for 3 weeks with the evidence in hand. Extend it so the case becomes a card.
- Crew names in filenames mint small guest cards (7 today). Fold onto the crew card.

## Review (2026-10-04, shipped as edfdcc2)
- Margin measured: guest impostor p50 0.30 / p99 0.91, 19 of 636 above 0.70 with a second identity above 0.70 → AUTO_MARGIN 0.10 holds 17. Crew: 1 of 132.
- Migration 094 applied to production before the push (schema_migrations 20261005000456).
- Build clean in the worktree; pre-push typecheck + lint clean; Vercel READY for edfdcc2; root 200; the new route 307s unauthenticated.
- First live scan (WEKA SKO27 // Event Photos, scripts/triage/scan-one-event.ts): 57 anonymous clusters, 3 new matches, all 3 auto-confirmed at 0.78 (Jade Monroe 3, Christian Ott 4, Liran Zvibel 55). Strip rendered in Mason's Chrome with both faces; review modal opened as "Auto-matched to …" with Looks right / Undo; "Looks right" on Jade set reviewed_at and the strip dropped to 2.
- NOT exercised live: Undo. All three matches were right, and an undo on a right match writes the name into rejected_names durably. Covered by reading the path only; first real wrong match will be the live test.
- Erin Curdie rename: blocked by the auto-mode permission layer (production data write); handed to Mason as a Run block.
