-- Schoolbook — Add school location (state, city)
-- Phase 0: run this in the Supabase SQL Editor AFTER 001 and 002
--
-- No RLS policy changes needed — schools_select_own / schools_update_own
-- already cover the whole row, new columns included. This migration only
-- adds the columns and updates the onboarding RPC that populates them.

-- ============================================================
-- Nigerian states enum — keeps location data consistent for any
-- future filtering/reporting, instead of free-text variants like
-- "Lagos" / "lagos" / "Lagos State" all meaning the same thing.
-- ============================================================
create type nigerian_state as enum (
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi',
  'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
  'Federal Capital Territory'
);

-- Assumes no schools have been onboarded yet (dev environment, pre-launch),
-- so a straight NOT NULL add is safe. If this errors because rows already
-- exist, tell me and I'll switch this to a nullable add + backfill instead.
alter table public.schools
  add column state nigerian_state not null,
  add column city text not null;

-- ============================================================
-- Updated onboarding RPC — now also takes state + city.
-- Dropped and recreated (rather than CREATE OR REPLACE) since
-- parameter names are changing, not just being appended.
-- ============================================================
drop function if exists public.create_school_and_first_account(text, text, text);

create or replace function public.create_school_and_first_account(
  p_school_name text,
  p_state nigerian_state,
  p_city text,
  p_contact_email text default null,
  p_contact_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_school_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create a school';
  end if;

  if exists (select 1 from public.accounts where id = auth.uid()) then
    raise exception 'This user already belongs to a school';
  end if;

  insert into public.schools (name, state, city, contact_email, contact_phone)
  values (p_school_name, p_state, p_city, p_contact_email, p_contact_phone)
  returning id into new_school_id;

  insert into public.accounts (id, school_id, email, role)
  values (auth.uid(), new_school_id, auth.jwt() ->> 'email', 'admin');

  return new_school_id;
end;
$$;

revoke all on function public.create_school_and_first_account from public;
grant execute on function public.create_school_and_first_account to authenticated;
