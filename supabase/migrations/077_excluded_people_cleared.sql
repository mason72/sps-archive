-- What a "Not a person" took with it, so its undo can put it back exactly.
--
-- Until 2026-09-11 an exclusion only hid a name from the People wall. The
-- naming engine never read it: "WekaSKO27_EventPhotos-03055.jpg" had stamped
-- "Weka SKO27" on all 57 face clusters of a 200-photo gallery, those clusters
-- became reference faces, and the suggestion tray offered the name 53 times.
-- An exclusion now also clears the label off every cluster carrying it (see
-- src/lib/people/exclude.ts). Clearing a name is only reversible if something
-- remembers which clusters had it and how each was spelled — this column.
--
-- Shape: [{ "id": <persons.id>, "name": <the label as it was> }]. NULL means
-- the exclusion cleared nothing (every exclusion made before this column).
-- The one writer is excludeNonPerson(); the one reader is restoreNonPerson().

alter table excluded_people add column if not exists cleared_persons jsonb;

comment on column excluded_people.cleared_persons is
  'Clusters this exclusion un-named, as [{id, name}], so the undo restores exactly those labels (and never over a name typed since). NULL = nothing cleared.';
