-- Schoolbook — Initial production schema
-- Phase 0: run this in the Supabase SQL Editor (SQL Editor -> New query -> Run)
-- Policies (RLS rules) are added in a separate migration next — until then,
-- RLS is enabled with zero policies, which means authenticated users can
-- read/write nothing. That's the safe default while policies are pending.

create extension if not exists pgcrypto;

-- ============================================================
-- Enums
-- ============================================================
create type fee_item_type as enum ('one-off', 'recurring');
create type fee_item_applies_to as enum ('new-students-only', 'all-students');
create type student_status as enum ('new', 'existing', 'withdrawn', 'graduated');
create type payment_method as enum ('cash', 'bank-transfer', 'pos', 'other');
create type discount_type as enum ('percent', 'fixed');
create type enrollment_type as enum ('initial', 'promoted', 'repeated');
create type account_role as enum ('admin');

-- ============================================================
-- School (tenant)
-- ============================================================
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  contact_email text,
  contact_phone text,
  subscription_status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Accounts — one per Supabase auth user, tags them to a school
-- ============================================================
create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null,
  role account_role not null default 'admin',
  created_at timestamptz not null default now()
);
create index accounts_school_id_idx on public.accounts (school_id);

-- ============================================================
-- Session / Term
-- ============================================================
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null, -- e.g. "2025/2026"
  start_date date,
  end_date date,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create index sessions_school_id_idx on public.sessions (school_id);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  name text not null, -- "Term 1" / "Term 2" / "Term 3"
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);
create index terms_school_id_idx on public.terms (school_id);
create index terms_session_id_idx on public.terms (session_id);

-- ============================================================
-- Class Level / Class Arm
-- ============================================================
create table public.class_levels (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null, -- "Kindergarten", "Primary 1", "JSS1", "SS3"...
  sort_order integer not null,
  created_at timestamptz not null default now()
);
create index class_levels_school_id_idx on public.class_levels (school_id);

create table public.class_arms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  class_level_id uuid not null references public.class_levels (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  name text not null, -- "A", "B", "C"...
  created_at timestamptz not null default now()
);
create index class_arms_school_id_idx on public.class_arms (school_id);
create index class_arms_class_level_id_idx on public.class_arms (class_level_id);
create index class_arms_session_id_idx on public.class_arms (session_id);

-- ============================================================
-- Fee Item + per-class-level pricing
-- ============================================================
create table public.fee_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  type fee_item_type not null,
  applies_to fee_item_applies_to not null,
  created_at timestamptz not null default now()
);
create index fee_items_school_id_idx on public.fee_items (school_id);

create table public.fee_item_pricing (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  fee_item_id uuid not null references public.fee_items (id) on delete cascade,
  class_level_id uuid not null references public.class_levels (id) on delete cascade,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (fee_item_id, class_level_id)
);
create index fee_item_pricing_school_id_idx on public.fee_item_pricing (school_id);

-- ============================================================
-- Household / Guardian
-- ============================================================
create table public.households (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null, -- e.g. "Mr. & Mrs. Okafor"
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);
create index households_school_id_idx on public.households (school_id);
create index households_phone_idx on public.households (school_id, phone);

-- ============================================================
-- Student
-- ============================================================
create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  other_names text,
  admission_number text not null,
  status student_status not null default 'new',
  date_of_birth date,
  gender text,
  guardian_name text,
  guardian_phone text,
  address text,
  household_id uuid references public.households (id) on delete set null,
  current_class_arm_id uuid references public.class_arms (id) on delete set null,
  admission_session_id uuid references public.sessions (id) on delete set null,
  status_changed_at timestamptz,
  status_reason text,
  created_at timestamptz not null default now(),
  unique (school_id, admission_number)
);
create index students_school_id_idx on public.students (school_id);
create index students_household_id_idx on public.students (household_id);
create index students_current_class_arm_id_idx on public.students (current_class_arm_id);
create index students_status_idx on public.students (school_id, status);

-- ============================================================
-- Enrollment History — append-only, preserved across promotions
-- ============================================================
create table public.enrollment_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  class_level_id uuid not null references public.class_levels (id) on delete cascade,
  class_arm_id uuid not null references public.class_arms (id) on delete cascade,
  type enrollment_type not null default 'initial',
  created_at timestamptz not null default now()
);
create index enrollment_history_school_id_idx on public.enrollment_history (school_id);
create index enrollment_history_student_id_idx on public.enrollment_history (student_id);

-- ============================================================
-- Charge — append-only, never updated once created
-- ============================================================
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  fee_item_id uuid not null references public.fee_items (id) on delete restrict,
  session_id uuid not null references public.sessions (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  class_level_id uuid not null references public.class_levels (id) on delete restrict,
  amount_expected numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index charges_school_id_idx on public.charges (school_id);
create index charges_student_id_idx on public.charges (student_id);
create index charges_term_id_idx on public.charges (term_id);

-- ============================================================
-- Payment — append-only. Voids are inserted as reversal rows
-- (negative amount_paid, void_of_payment_id set), never edits to
-- the original row. This is what keeps offline sync safe: two
-- devices can never "overwrite" a payment, only add to the ledger.
-- ============================================================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  charge_id uuid not null references public.charges (id) on delete restrict,
  amount_paid numeric(12,2) not null, -- negative for a void/reversal row
  date_paid date not null default current_date,
  method payment_method not null default 'cash',
  receipt_number text,
  recorded_by uuid references public.accounts (id) on delete set null,
  household_transaction_id uuid, -- shared across a split household payment
  void_of_payment_id uuid references public.payments (id) on delete restrict,
  void_reason text,
  created_at timestamptz not null default now()
);
create index payments_school_id_idx on public.payments (school_id);
create index payments_charge_id_idx on public.payments (charge_id);
create index payments_student_id_idx on public.payments (student_id);
create index payments_household_txn_idx on public.payments (household_transaction_id);

-- ============================================================
-- Student Note — the one mutable exception (pin/unpin, archive)
-- ============================================================
create table public.student_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  text text not null,
  created_by uuid references public.accounts (id) on delete set null,
  pinned boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index student_notes_school_id_idx on public.student_notes (school_id);
create index student_notes_student_id_idx on public.student_notes (student_id);

-- ============================================================
-- Write-Off — append-only, permanent, never edited or deleted
-- ============================================================
create table public.write_offs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  charge_id uuid not null references public.charges (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete cascade,
  amount numeric(12,2) not null,
  reason text not null,
  written_off_by uuid references public.accounts (id) on delete set null,
  created_at timestamptz not null default now()
);
create index write_offs_school_id_idx on public.write_offs (school_id);
create index write_offs_charge_id_idx on public.write_offs (charge_id);

-- ============================================================
-- Discount — standing rule. Not a financial ledger entry itself,
-- so an "active" flag is acceptable here (unlike Payments/Charges).
-- ============================================================
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  fee_item_id uuid not null references public.fee_items (id) on delete cascade,
  type discount_type not null,
  value numeric(12,2) not null,
  reason text not null,
  applied_by uuid references public.accounts (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index discounts_school_id_idx on public.discounts (school_id);
create index discounts_student_id_idx on public.discounts (student_id);

-- ============================================================
-- Audit Log — append-only
-- ============================================================
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  actor_id uuid references public.accounts (id) on delete set null,
  action text not null, -- e.g. "payment.recorded", "student.withdrawn"
  entity_type text not null, -- e.g. "student", "payment", "charge"
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_school_id_idx on public.audit_log (school_id);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ============================================================
-- Data API grants — required since Supabase's May 2026 default
-- stopped auto-exposing new public-schema tables to the API.
-- ============================================================
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ============================================================
-- Enable RLS everywhere. No policies yet (next migration) — with
-- RLS on and zero policies, Postgres denies all access by default,
-- so this is safe to run before policies exist.
-- ============================================================
alter table public.schools enable row level security;
alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
alter table public.terms enable row level security;
alter table public.class_levels enable row level security;
alter table public.class_arms enable row level security;
alter table public.fee_items enable row level security;
alter table public.fee_item_pricing enable row level security;
alter table public.households enable row level security;
alter table public.students enable row level security;
alter table public.enrollment_history enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.student_notes enable row level security;
alter table public.write_offs enable row level security;
alter table public.discounts enable row level security;
alter table public.audit_log enable row level security;

-- ============================================================
-- Re-grant SELECT to powersync_role — the grant made during the
-- PowerSync setup step only covered tables that existed at that
-- time. These tables are new, so PowerSync needs this to replicate them.
-- ============================================================
grant select on all tables in schema public to powersync_role;
alter default privileges in schema public grant select on tables to powersync_role;
