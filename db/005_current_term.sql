-- Schoolbook — Real "current term" concept
-- Phase 2: run this in the Supabase SQL Editor AFTER 001-004.
--
-- Until now there was no explicit "current term" anywhere in the schema —
-- only sessions.is_active existed. Every screen that needed to know
-- "what term is this student on right now" (student profile, payment
-- allocation) faked it by picking the most recent term the student
-- happened to already have a charge in. That's a reasonable fallback per
-- student, but it breaks down for school-wide aggregates (the dashboard,
-- reports) where there's no "this student's charges" to anchor on — those
-- need one real, explicit current term for the whole school.
--
-- This adds terms.is_current, with a partial unique index so at most one
-- term can be flagged current per school at a time (mirrors how
-- sessions.is_active already works). Existing schools get backfilled to
-- the most recent term of their active session, so nothing changes
-- visibly until an admin explicitly picks a different one going forward.

alter table public.terms add column is_current boolean not null default false;

-- Backfill: for each school, flag the most-recently-created term within
-- its active session as current (matches the old per-student inference
-- logic, applied once at the school level).
with active_session as (
  select school_id, id as session_id
  from public.sessions
  where is_active = true
),
latest_term as (
  select distinct on (t.school_id)
    t.id, t.school_id
  from public.terms t
  join active_session s on s.session_id = t.session_id
  order by t.school_id, t.created_at desc
)
update public.terms
set is_current = true
where id in (select id from latest_term);

-- At most one current term per school.
create unique index terms_school_current_unique on public.terms (school_id) where is_current = true;
