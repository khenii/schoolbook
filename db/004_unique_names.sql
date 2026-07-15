-- Schoolbook — Enforce unique names for fee items, class levels, and arms
-- Phase 1: run this in the Supabase SQL Editor AFTER deleting any existing
-- duplicates (see chat) — this will fail if duplicates still exist, by design.

-- Fee item names must be unique per school (case-insensitive) — there's no
-- legitimate reason for two "School Fees" entries; price changes belong in
-- fee_item_pricing, not a second fee item.
create unique index fee_items_school_id_name_unique
  on public.fee_items (school_id, lower(name));

-- Class level names must be unique per school (case-insensitive).
create unique index class_levels_school_id_name_unique
  on public.class_levels (school_id, lower(name));

-- Arm names must be unique within a class level for a given session
-- (case-insensitive) — two "A" arms under the same level+session would be
-- exactly as confusing as duplicate fee items.
create unique index class_arms_level_session_name_unique
  on public.class_arms (class_level_id, session_id, lower(name));
