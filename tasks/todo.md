# Auto-match: the identity engine confirms its own sure matches (2026-10-04)

Mason's decision (card, 2026-10-04): auto-confirm at 0.70 with a review strip.
Data behind it: 869 confirmed / 7 rejected; every rejection scored 0.55–0.58;
nothing above 0.58 ever rejected; 0.70 would have handled 88% of past confirms.

- [ ] 0. Measure the margin guard: nearest OTHER identity for every confirmed cluster
      (`scripts/triage/auto-confirm-margin.ts`, read-only). Pick AUTO_MARGIN from data.
- [ ] 1. Migration 094: `decided_by text` ('human'|'auto'), `reviewed_at timestamptz`,
      partial index for the strip; backfill decided rows as 'human'.
- [ ] 2. Extract `decideOne` + `teachEvent` from the route into `src/lib/people/identity-decide.ts`
      (one confirm path; add `decidedBy`). Route imports it. Add `undo` for auto rows.
- [ ] 3. Pure `decideAutoConfirm()` in identity-suggestions.ts + tests: unnamed cluster,
      sim ≥ AUTO_CONFIDENCE, runner-up of a different identity ≤ sim − AUTO_MARGIN.
- [ ] 4. Scan: after upserting a pending row that qualifies, confirm it via decideOne
      (teach:false, decidedBy:'auto'); teach once per event; refresh index once; report `autoConfirmed`.
- [ ] 5. UI: "Auto-matched · Review" strip on /people — faces, name, event, confidence;
      "Looks right" (single + all) sets reviewed_at; "Undo" reverts (guest: name→null + rejected;
      crew: unlink) and refreshes the wall.
- [ ] 6. Docs: AI.md invariant amended (why, by whom, the guards), GOTCHAS line, CLAUDE.md
      one-liner, memory file, lessons entry. Erin/Phil follow-up noted.
- [ ] 7. Verify: vitest, tsc, build in worktree; live-event gate; push; watch deploy;
      trigger a real scan; see the strip populate; undo one; confirm the wall.

## Follow-ups (not this build)
- Mislabel detector ignores crew-linked clusters: Erin Curdie's 6 frames sat under
  Phil Clarke for 3 weeks with the evidence in hand. Extend it so the case becomes a card.
- Crew names in filenames mint small guest cards (7 today). Fold onto the crew card.
