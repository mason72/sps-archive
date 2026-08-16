-- 063: a human clearing a cluster's name is a statement — "the filename is
-- wrong" — and it must be durable. Before this column, clearing a name only
-- set it NULL, and the fill-nulls-only consensus namer re-applied the SAME
-- wrong name on the next clustering run (first hit live 2026-08-16: a
-- stranger's photos exported under "Jenna Wombles"'s filename; Mason cleared
-- the name, and nothing recorded that the name was wrong).
--
-- rejected_names holds every name a human has explicitly cleared from this
-- cluster. Consensus naming skips them (compared case-insensitively on a
-- letters-only key, so a spelling variant of a rejected name stays rejected).
-- A human typing a name directly is never blocked — rejection gates only the
-- automatic path.
alter table persons
  add column if not exists rejected_names text[] not null default '{}';
