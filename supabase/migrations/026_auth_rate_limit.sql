-- Rate limiting for public credential checks (gallery passwords, download
-- PINs). Before this, both could be brute-forced with a bash loop — a 4-digit
-- PIN has 10k combinations.
--
-- Fixed-window counter keyed by "<scope>:<slug>:<ip>", incremented atomically
-- by record_auth_attempt(). Returns whether this attempt is still within the
-- allowance. RLS enabled with no policies: only the service role touches it.
create table auth_attempts (
  key           text primary key,
  attempts      int not null default 0,
  window_start  timestamptz not null default now()
);

alter table auth_attempts enable row level security;

create or replace function record_auth_attempt(
  p_key text,
  p_max int,
  p_window_seconds int
) returns boolean
language plpgsql
as $$
declare
  allowed boolean;
begin
  insert into auth_attempts as a (key, attempts, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    attempts = case
      when a.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else a.attempts + 1
    end,
    window_start = case
      when a.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else a.window_start
    end
  returning attempts <= p_max into allowed;
  return allowed;
end
$$;
