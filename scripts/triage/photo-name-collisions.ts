/**
 * Re-check the rule the recap's photo count rests on: within one event, rows
 * that share an `original_filename` are versions of ONE picture
 * (src/lib/recap/photo-count.ts). Read-only.
 *
 * For every event with same-name rows it prints how many name groups there
 * are, and splits them by capture time:
 *   - one_time:   every row has a capture time and they agree (versions of one photo),
 *   - many_times: rows carry DIFFERENT capture times (two pictures, or a re-upload),
 *   - no_time:    some row has no capture time (no evidence either way).
 *
 * On 2026-10-26 `many_times` was 0 everywhere except F1 Cash App, whose two
 * copies differ only because SPS stamps the re-upload time. A new event with
 * `many_times` > 0 is a name collision the recap would undercount: look at it.
 *
 *   npx tsx scripts/triage/photo-name-collisions.ts
 */
import { execFileSync } from "node:child_process";

const SQL = `
with g as (
  select e.id, e.name ev, trim(i.original_filename) f,
         count(distinct i.id) n,
         count(distinct i.taken_at) times,
         bool_or(i.taken_at is null) any_null
  from images i join events e on e.id = i.event_id
  where i.thumbnail_generated and not i.is_cover_upload and nullif(trim(i.original_filename), '') is not null
  group by e.id, e.name, trim(i.original_filename)
  having count(distinct i.id) > 1
)
select ev as event, count(*) as groups, sum(n) as rows,
       count(*) filter (where times = 1 and not any_null) as one_time,
       count(*) filter (where times > 1) as many_times,
       count(*) filter (where any_null) as no_time
from g group by id, ev
order by count(*) filter (where times > 1) desc, sum(n) desc`;

execFileSync("npx", ["tsx", "scripts/db-sql.ts", "--query", SQL], { stdio: "inherit" });
