# Schoolbook — Project Handoff & Roadmap

**Purpose of this document:** everything needed to pick this project up and
run it as a real engineering build — what exists today, what it does, what's
left to decide, and a phased backlog to work through. Written to be handed
to a project manager, a developer, or dropped into Cowork to coordinate
the next phase.

---

## 1. What this project is

A multi-tenant school management web app for tracking classes, students,
fees, and payments — built for schools running Kindergarten through SS3,
with particular attention to real Nigerian school operations: arrears that
carry across years, sibling households paying in lump sums, and offline
resilience for unreliable connectivity.

Two things exist today:
1. **A full data model and business-rules spec** (`school-management-system-spec.md`)
2. **A clickable HTML prototype** — 10 screens, fully linked, demonstrating
   every interaction with realistic demo data (no backend — everything
   lives in browser JS and resets on refresh)

The prototype's job was to pressure-test the data model against real
scenarios before writing production code. That's done. This document is
the bridge to the next phase: an actual build.

---

## 2. Prototype inventory

| # | Screen | File | What it does |
|---|--------|------|---------------|
| 1 | Onboarding | `01-onboarding.html` | School sign-up (confirm class levels) + login |
| 2 | Dashboard | `06-dashboard.html` | School-wide stats, defaulters preview, activity feed, quick links |
| 3 | Students | `04-students.html` | Paginated roster (~480 demo students), search, add student with guardian/household matching, auto-generated charges |
| 4 | Student Profile | `05-student-profile.html` | Pinned notes, household/siblings, balance stats, arrears breakdown, current charges, discounts, write-offs, full 12-session academic history, withdrawal flow |
| 5 | Payments | `07-payments.html` | Payment log with filters, single or household split-payment recording, void with reason, printable receipts, CSV export |
| 6 | Class Register | `10-class-register.html` | Treat an entire class/arm's payments for one fee item at a time, paginated |
| 7 | Promotion | `11-promotion.html` | End-of-session bulk promotion with per-student repeat/withdraw override |
| 8 | Reports | `08-reports.html` | Defaulters, Arrears, and Collections-summary tabs, CSV export |
| 9 | Settings | `09-settings.html` | Classes & Arms and Fee Items configuration (tabbed) |
| 10 | Audit Log | `12-audit-log.html` | Unified, filterable, exportable timeline of every consequential action |

All screens share one design system (navy/slate/gold, Source Serif 4 +
Inter + IBM Plex Mono) and are cross-linked into a single coherent flow.

---

## 3. Data model at a glance

Full detail is in the spec. Core entities:

- **School** (tenant) → **Account/User** (one login per school, Phase 1)
- **Session** → **Term** (3 per session)
- **Class Level** → **Arm** (both configurable)
- **Fee Item** (one-off/recurring, flat or per-class-level pricing)
- **Student** → **enrollmentHistory** (preserved across promotions)
- **Charge** (generated per student/term/fee item) → **Payment** (against a charge)
- **Guardian/Household** (links siblings by phone match)
- **Student Note** (pinned, informational)
- **Write-Off** (forgives an existing charge, reason required, permanent)
- **Discount** (standing rule, reduces future charges, reason required)
- **Audit Log entry** (every consequential action, who/what/when)

**Non-negotiable rules worth re-reading before build starts:** §3.3
(arrears carry forward across sessions, never reset), §6.2 (multi-tenancy
enforced at the database layer via row-level security, not just app code),
§3.9 (promotion is never automatic).

---

## 4. Build roadmap

### Phase 0 — Foundation (nothing else should start before this) — ✅ complete 2026-07-14
- [x] Stand up Supabase project (Postgres + Auth) as the backend of record
- [x] Implement School/Account auth with Postgres RLS enforcing tenant
      isolation (`schoolId` scoping enforced at the database layer)
- [x] Stand up PowerSync (hosted Cloud tier to start) and define sync rules
      partitioning every table by `schoolId`
- [x] Design schema with **Payments and Charges as append-only (insert-only)
      tables** — avoids silent conflict-merge loss of financial records
      during offline sync
- [x] Build offline-first client on PowerSync's local SQLite layer (replaces
      the earlier raw IndexedDB/Dexie plan)
- [x] Set up CI, staging environment, error monitoring (GitHub + Vercel +
      Sentry)

### Phase 1 — Core loop
- [ ] School onboarding (sign-up, class level selection, login)
- [ ] Classes & Arms configuration
- [ ] Fee Items configuration (flat + per-class pricing, one-off/recurring)
- [ ] Student CRUD, auto-generated charges on enrollment
- [ ] Guardian/household matching by phone at enrollment
- [ ] Payment recording (single student), balance calculation
- [ ] Student profile: balance, arrears, payment history

### Phase 2 — Operational tools
- [ ] Dashboard (real stats, not demo data)
- [ ] Class Register (paginated, real backend queries)
- [ ] Reports: Defaulters, Arrears, Collections summary
- [ ] Household split payments
- [ ] CSV export (server-generated for large datasets, not client-side)

### Phase 3 — Trust & correction tools
- [ ] Write-offs (reason required, permanent record)
- [ ] Discounts/waivers (standing rules, applied at charge generation)
- [ ] Payment voiding (reason required, balance reversal)
- [ ] Receipts (printable, consider PDF generation server-side)
- [ ] Pinned notes

### Phase 4 — Lifecycle tools
- [ ] Promotion flow (bulk + per-student override)
- [ ] Withdrawal/exit flow (exit checklist, inactive status, roster filtering)
- [ ] Audit log (real event logging wired into every action above, not
      a demo dataset)

### Phase 5 — Pilot
- [ ] Migrate one real school's data (use the "reported vs enrolled"
      headcount pattern from Classes & Arms to track migration progress)
- [ ] Run a full term with real staff, real payments
- [ ] Collect friction points before wider rollout

### Phase 6 — Not yet scoped (future consideration)
- Parent-facing read-only balance view
- Payment gateway integration (Paystack/Flutterwave) instead of manual entry
- Multi-user logins per school (roles: bursar, principal, teacher)
- SMS/email payment reminders
- Report cards / academic performance (explicitly out of scope for this product)

---

## 5. Open decisions still needed before/during build

- **Household matching fallback:** phone-match is the only mechanism today.
  What happens when a second guardian uses a different number? Worth a
  manual "search and link an existing household by name" fallback.
- **Discount + write-off interaction:** if a student has both a standing
  discount and a write-off on the same fee item, is the display order/
  interaction clear enough, or does it need its own summary view?
- **Receipt format requirements:** any specific format/legal requirements
  for Nigerian school receipts worth confirming before building PDF export?
- **Data export destination:** client-side CSV is fine for the prototype;
  confirm whether the real product needs scheduled/automated exports
  (e.g. nightly backup to a drive) vs. on-demand only.
- **Multi-user timeline:** spec assumes one login per school for Phase 1 —
  confirm how soon multi-staff access (bursar + principal) becomes a
  real requirement, since it affects the audit log's value from day one.
- **PowerSync hosting:** hosted PowerSync Cloud (faster to start, small
  monthly cost) vs. self-hosting PowerSync (more ops work, no vendor
  cost) — default assumption is hosted Cloud for Phase 0; revisit if cost
  or data-residency becomes a concern.

---

## 6. Recommended stack — decided 2026-07-14

- **Frontend:** React, PWA-enabled
- **Backend:** Supabase (Postgres + Auth), with RLS policies enforcing
  `schoolId` tenant isolation at the database layer
- **Offline sync:** PowerSync — local SQLite on-device (offline-first
  reads/writes), synced to Supabase Postgres via PowerSync's sync rules.
  Chosen over Firebase and over a fully custom Dexie.js + hand-built sync
  engine — see decision log below.
- **Hosting:** any static host + Supabase + PowerSync Cloud (hosted tier to
  start; self-hosting PowerSync is a later option if cost/ops requires it)

### Decision log

**2026-07-14 — Sync/backend stack: Supabase + PowerSync.**
Three options were weighed:
1. *Firebase (Firestore)* — most battle-tested offline persistence
   (built into the SDK), but tenant isolation would move from SQL RLS to
   Firestore Security Rules, and the spec's reporting needs (defaulters,
   arrears, collections rollups) are more awkward on a NoSQL document
   store than plain SQL.
2. *Supabase + PowerSync (chosen)* — real Postgres and RLS exactly as
   specified in §6.2, SQL for reporting, and a purpose-built offline-sync
   layer (PowerSync) instead of writing one from scratch. Adds one extra
   vendor/service on top of Supabase.
3. *Fully custom (Supabase + Dexie.js + hand-built outbox sync)* — most
   control, no extra vendor, but the sync/conflict-resolution engine is
   the highest-risk code in the whole project to build correctly, and bugs
   there are the kind that silently lose a recorded payment. Rejected as
   too slow and too risky to build in-house for Phase 0.

Rationale for the choice: Supabase + PowerSync is the only option that
keeps both the spec's DB-layer RLS requirement and a proven offline-sync
implementation, without the team building and debugging a custom sync
engine. Payments and Charges will additionally be modeled as append-only
tables (insert-only, never updated) specifically to reduce conflict-merge
risk on financial records during offline sync.

---

## 7. Suggested next step

Hand this document and the spec to whoever runs the build — a developer,
a dev team, or an agentic tool like **Claude Code** for implementation
work. For ongoing project coordination (tracking the phase-by-phase
backlog above, chasing open decisions, managing the pilot), **Cowork** is
a good fit: it can hold this roadmap, break Phase 1 into tracked tasks,
and coordinate the many small follow-ups a project like this generates.
