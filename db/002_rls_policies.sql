-- Schoolbook — Row Level Security policies
-- Phase 0: run this in the Supabase SQL Editor AFTER 001_initial_schema.sql
--
-- Enforces spec §6.2: every table is scoped to the logged-in user's
-- school_id at the database layer, so no query path — buggy or
-- malicious — can read or write across tenants.
--
-- Design notes:
-- - Append-only tables (charges, payments, enrollment_history,
--   write_offs, audit_log) get SELECT + INSERT policies only. No
--   UPDATE or DELETE policy exists for them at all, which means
--   Postgres denies those operations outright — this is what makes
--   "payments are never edited, only reversed" a database-enforced
--   guarantee, not just an app-code convention.
-- - student_notes and discounts get SELECT + INSERT + UPDATE (for
--   pin/archive and active/removed_at toggles) but no DELETE, so the
--   history trail is never lost.
-- - Everything else (schools, sessions, terms, class levels/arms,
--   fee items, households, students) gets full CRUD scoped by school.

-- ============================================================
-- Helper: resolve the logged-in user's school_id
-- SECURITY DEFINER so it can read public.accounts without
-- recursively triggering that table's own RLS policy.
-- ============================================================
create or replace function public.current_school_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select school_id from public.accounts where id = auth.uid()
$$;

revoke all on function public.current_school_id() from public;
grant execute on function public.current_school_id() to authenticated;

-- ============================================================
-- Onboarding RPC — creates a School + the first Account together.
-- Needed because a brand-new user has no school_id yet, so normal
-- RLS-gated inserts can't bootstrap the very first row. This
-- function runs as SECURITY DEFINER to perform that one bootstrap
-- insert, and refuses to run if the caller already has an account.
-- ============================================================
create or replace function public.create_school_and_first_account(
  school_name text,
  contact_email text default null,
  contact_phone text default null
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

  insert into public.schools (name, contact_email, contact_phone)
  values (school_name, contact_email, contact_phone)
  returning id into new_school_id;

  insert into public.accounts (id, school_id, email, role)
  values (auth.uid(), new_school_id, auth.jwt() ->> 'email', 'admin');

  return new_school_id;
end;
$$;

revoke all on function public.create_school_and_first_account from public;
grant execute on function public.create_school_and_first_account to authenticated;

-- ============================================================
-- schools — read/update own school only. No client-side insert
-- (goes through the RPC above) or delete.
-- ============================================================
create policy "schools_select_own" on public.schools
  for select to authenticated
  using (id = public.current_school_id());

create policy "schools_update_own" on public.schools
  for update to authenticated
  using (id = public.current_school_id())
  with check (id = public.current_school_id());

-- ============================================================
-- accounts — read accounts within your own school. No client-side
-- insert/update/delete (account creation goes through the RPC above).
-- ============================================================
create policy "accounts_select_own_school" on public.accounts
  for select to authenticated
  using (school_id = public.current_school_id());

-- ============================================================
-- sessions
-- ============================================================
create policy "sessions_select" on public.sessions
  for select to authenticated using (school_id = public.current_school_id());
create policy "sessions_insert" on public.sessions
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "sessions_update" on public.sessions
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "sessions_delete" on public.sessions
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- terms
-- ============================================================
create policy "terms_select" on public.terms
  for select to authenticated using (school_id = public.current_school_id());
create policy "terms_insert" on public.terms
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "terms_update" on public.terms
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "terms_delete" on public.terms
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- class_levels
-- ============================================================
create policy "class_levels_select" on public.class_levels
  for select to authenticated using (school_id = public.current_school_id());
create policy "class_levels_insert" on public.class_levels
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "class_levels_update" on public.class_levels
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "class_levels_delete" on public.class_levels
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- class_arms
-- ============================================================
create policy "class_arms_select" on public.class_arms
  for select to authenticated using (school_id = public.current_school_id());
create policy "class_arms_insert" on public.class_arms
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "class_arms_update" on public.class_arms
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "class_arms_delete" on public.class_arms
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- fee_items
-- ============================================================
create policy "fee_items_select" on public.fee_items
  for select to authenticated using (school_id = public.current_school_id());
create policy "fee_items_insert" on public.fee_items
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "fee_items_update" on public.fee_items
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "fee_items_delete" on public.fee_items
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- fee_item_pricing
-- ============================================================
create policy "fee_item_pricing_select" on public.fee_item_pricing
  for select to authenticated using (school_id = public.current_school_id());
create policy "fee_item_pricing_insert" on public.fee_item_pricing
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "fee_item_pricing_update" on public.fee_item_pricing
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "fee_item_pricing_delete" on public.fee_item_pricing
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- households
-- ============================================================
create policy "households_select" on public.households
  for select to authenticated using (school_id = public.current_school_id());
create policy "households_insert" on public.households
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "households_update" on public.households
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "households_delete" on public.households
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- students
-- ============================================================
create policy "students_select" on public.students
  for select to authenticated using (school_id = public.current_school_id());
create policy "students_insert" on public.students
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "students_update" on public.students
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
create policy "students_delete" on public.students
  for delete to authenticated using (school_id = public.current_school_id());

-- ============================================================
-- enrollment_history — append-only: select + insert only
-- ============================================================
create policy "enrollment_history_select" on public.enrollment_history
  for select to authenticated using (school_id = public.current_school_id());
create policy "enrollment_history_insert" on public.enrollment_history
  for insert to authenticated with check (school_id = public.current_school_id());

-- ============================================================
-- charges — append-only: select + insert only
-- ============================================================
create policy "charges_select" on public.charges
  for select to authenticated using (school_id = public.current_school_id());
create policy "charges_insert" on public.charges
  for insert to authenticated with check (school_id = public.current_school_id());

-- ============================================================
-- payments — append-only: select + insert only (voids are new rows)
-- ============================================================
create policy "payments_select" on public.payments
  for select to authenticated using (school_id = public.current_school_id());
create policy "payments_insert" on public.payments
  for insert to authenticated with check (school_id = public.current_school_id());

-- ============================================================
-- student_notes — select + insert + update (pin/archive), no delete
-- ============================================================
create policy "student_notes_select" on public.student_notes
  for select to authenticated using (school_id = public.current_school_id());
create policy "student_notes_insert" on public.student_notes
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "student_notes_update" on public.student_notes
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());

-- ============================================================
-- write_offs — append-only, permanent: select + insert only
-- ============================================================
create policy "write_offs_select" on public.write_offs
  for select to authenticated using (school_id = public.current_school_id());
create policy "write_offs_insert" on public.write_offs
  for insert to authenticated with check (school_id = public.current_school_id());

-- ============================================================
-- discounts — select + insert + update (active/removed_at), no delete
-- ============================================================
create policy "discounts_select" on public.discounts
  for select to authenticated using (school_id = public.current_school_id());
create policy "discounts_insert" on public.discounts
  for insert to authenticated with check (school_id = public.current_school_id());
create policy "discounts_update" on public.discounts
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());

-- ============================================================
-- audit_log — append-only: select + insert only
-- ============================================================
create policy "audit_log_select" on public.audit_log
  for select to authenticated using (school_id = public.current_school_id());
create policy "audit_log_insert" on public.audit_log
  for insert to authenticated with check (school_id = public.current_school_id());
