-- Build progress for background ZIP jobs: the builder bumps images_done
-- every ~25 appended photos so the gallery's "Preparing…" toast can show a
-- moving "612 of 1553" instead of an anonymous spinner. image_count is now
-- written at build START (it's the selection size) so the total is available
-- while building, not only after.

alter table zip_jobs add column images_done int not null default 0;
