-- What the database actually costs, in one query.
--
-- /ops meters Modal and R2 but has never shown the database, which is exactly
-- why its cost crept up unnoticed until it was modelled by hand on 2026-08-12.
-- RAM is the expensive resource here — Supabase sells it as instance tiers at
-- roughly $13/GB/month, against $0.125/GB for disk and $0.015 for R2 — and the
-- thing that consumes it is the vector index, because similarity search has to
-- walk that structure in memory to stay fast.
--
-- So the number that predicts the bill is `vector_index_bytes`, not the size of
-- the database. A 50 GB database with a 1 GB vector index runs happily on a
-- small instance; a 5 GB database with a 14 GB index does not.
--
-- Vector indexes are identified by ACCESS METHOD (hnsw / ivfflat), not by name.
-- A name pattern like '%embedding%' would miss a future index and silently
-- under-report the one number this function exists to report.
--
-- The photo counts are here rather than in a second round trip so the growth
-- rate comes from the same scan, and so the page cannot show a size and a rate
-- measured at two different moments.

begin;

set local lock_timeout = '8s';

create or replace function public.database_footprint()
returns table (
  db_bytes bigint,
  vector_index_bytes bigint,
  other_index_bytes bigint,
  table_bytes bigint,
  photos_indexed bigint,
  faces_indexed bigint,
  photos_last_30d bigint,
  photos_last_90d bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with vec_am as (
    select oid from pg_am where amname in ('hnsw', 'ivfflat')
  ),
  idx as (
    select
      c.oid,
      c.relam in (select oid from vec_am) as is_vector,
      pg_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'i' and n.nspname = 'public'
  )
  select
    pg_database_size(current_database())::bigint as db_bytes,
    coalesce(sum(bytes) filter (where is_vector), 0)::bigint as vector_index_bytes,
    coalesce(sum(bytes) filter (where not is_vector), 0)::bigint as other_index_bytes,
    (
      select coalesce(sum(pg_table_size(c.oid)), 0)::bigint
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = 'public'
    ) as table_bytes,
    (select count(*) from images where siglip_embedding is not null)::bigint as photos_indexed,
    (select count(*) from faces where embedding is not null)::bigint as faces_indexed,
    (select count(*) from images where created_at > now() - interval '30 days')::bigint as photos_last_30d,
    (select count(*) from images where created_at > now() - interval '90 days')::bigint as photos_last_90d
  from idx;
$function$;

-- Server-only, like every other function here (049).
revoke all on function public.database_footprint() from public, anon, authenticated;
grant execute on function public.database_footprint() to service_role;

commit;
