-- Guest favorites were NEVER saved server-side: the favorites POST upserts
-- ON CONFLICT (share_id, image_id), but the table's unique key was
-- (share_id, image_id, client_email) — Postgres error 42P10, so every
-- favorite request returned 500 (invisible to guests, who only see the
-- optimistic localStorage heart). Anonymous favorites are the only flow
-- today (no client identity is ever sent), so key favorites by
-- (share_id, image_id) to match the code. Revisit if per-client identity
-- (ClientIdentityModal) ships.
delete from favorites a using favorites b
  where a.id > b.id and a.share_id = b.share_id and a.image_id = b.image_id;
alter table favorites drop constraint favorites_share_id_image_id_client_email_key;
alter table favorites add constraint favorites_share_image_key unique (share_id, image_id);
