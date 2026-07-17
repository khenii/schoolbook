-- Schoolbook — Fix audit_log.metadata column type
-- Phase 3: run this in the Supabase SQL Editor AFTER 001-005.
--
-- audit_log.metadata was declared `jsonb` in 001_initial_schema.sql, but
-- every write path disagrees with that: lib/auditLog.ts pre-serializes the
-- metadata object with JSON.stringify() before sending it, and PowerSync's
-- local schema (lib/powersync/schema.ts) declares the column as
-- `column.text` with the comment "JSON stored as text; JSON.parse on read"
-- — that's the actual, documented design (SQLite has no native JSON
-- column type, so PowerSync-synced JSON fields are always stored as text).
--
-- Sending a pre-stringified string into a `jsonb` column doesn't error —
-- Postgres happily stores it as a JSON *string scalar* (i.e. the jsonb
-- value literally is a string, not an object). Every read of that value
-- (including PowerSync's sync-down to the client) then carries an extra
-- layer of JSON encoding, so the app's single JSON.parse() on read unwraps
-- only the outer layer and hands back a plain string that still looks like
-- JSON text instead of the object it expects. Object.entries() on that
-- string decomposes it character-by-character, which is why the Audit Log
-- screen was rendering every metadata value as raw, letter-spaced JSON
-- text instead of a formatted detail line.
--
-- Fix: change the column to `text` (matching every other part of the
-- system), and unwrap already-corrupted existing rows in the same
-- statement. `#>> '{}'` extracts a jsonb value's text representation and,
-- critically, un-quotes a JSON string scalar back to its raw string
-- content — exactly undoing the double-encoding for existing rows. For any
-- row that was never corrupted (shouldn't exist here, but just in case),
-- `#>> '{}'` on a JSON object still returns its normal compact JSON text,
-- so this is safe either way.

-- Idempotent: only runs the type change if the column is still jsonb, so
-- this is safe to re-run after a first attempt already converted it (an
-- unconditional `ALTER ... USING (metadata #>> '{}')` fails the second
-- time with "operator does not exist: text #>> unknown", since #>> only
-- applies to jsonb — that's expected/harmless and just means this part is
-- already done).
do $$
begin
  if (
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_log' and column_name = 'metadata'
  ) = 'jsonb' then
    alter table public.audit_log
      alter column metadata type text
      using (metadata #>> '{}');
  end if;
end $$;

-- IMPORTANT — second step, required even though it looks redundant:
-- the ALTER COLUMN above rewrites the table on disk and fixes what's in
-- Postgres, but a column-type rewrite is DDL, not DML — it does not go
-- through Postgres's normal write path, so it emits no row-level UPDATE
-- events on the logical replication stream that PowerSync consumes.
-- Concretely: this migration alone fixes the value if you query Postgres
-- directly, but every browser that already synced these rows before this
-- migration ran keeps showing the old, corrupted copy from its local
-- SQLite cache — PowerSync has no signal that anything changed, so it
-- never re-pushes them.
--
-- A genuine UPDATE statement — even a no-op one — always writes a new row
-- version and DOES go through the normal path, so it reaches the
-- replication stream and PowerSync picks it up as a real change to sync
-- down. Running it here, after the ALTER above has already corrected the
-- value, means every client gets the *fixed* text pushed to it.
update public.audit_log set metadata = metadata;
