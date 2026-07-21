-- Schoolbook — Keep "current term" coupled to the active session
-- Phase 3: run this in the Supabase SQL Editor AFTER 001-006.
--
-- Two independent flags exist: sessions.is_active (§3.9 — "the one new
-- students and charges default to") and terms.is_current (§3.10 — "drives
-- the dashboard, reports, and each student's balance split"). Nothing
-- enforced that the current term actually belongs to the active session —
-- the Settings > Sessions tab let staff mark a term "current" inside any
-- session, including one that was never activated or has since been
-- superseded. That's how a term under an inactive session ended up flagged
-- current: the dashboard would then be showing figures anchored to a
-- session nobody's actively enrolling into anymore, which doesn't make
-- sense — "current" only has meaning relative to whichever session is
-- actually active right now.
--
-- This is a one-time data repair; the app code (SessionsTab.tsx) is being
-- changed alongside this migration to stop the inconsistency from
-- recurring — "Set as current" now only appears for terms in the active
-- session, and activating a session now also fixes up its current term.

-- Clear "current" from any term whose session isn't the active one.
update public.terms t
set is_current = false
from public.sessions s
where t.session_id = s.id
  and t.is_current = true
  and s.is_active = false;

-- Backfill: any school whose active session has no current term left
-- (either it never had one, or it just got cleared above) gets its
-- earliest term flagged current, matching the default a brand-new session
-- gets on creation.
with active_without_current as (
  select s.id as session_id
  from public.sessions s
  where s.is_active = true
    and not exists (
      select 1 from public.terms t where t.session_id = s.id and t.is_current = true
    )
),
earliest_term as (
  select distinct on (awc.session_id) t.id
  from active_without_current awc
  join public.terms t on t.session_id = awc.session_id
  order by awc.session_id, t.created_at asc
)
update public.terms
set is_current = true
where id in (select id from earliest_term);
