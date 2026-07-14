# School Management System — Specification Document

## 1. Overview

A web application for managing student records, class structure, and fee
payments for a school running Kindergarten through SS3. Built as an
**offline-first web app**: all data is written to local storage instantly and
synced to the cloud whenever an internet connection is available, so daily
operations (adding students, recording payments) are never blocked by
network or power outages.

**Primary users:** Admin / bursar (single user or small office team). No
teacher or parent access in this phase.

This is a **multi-tenant** product: multiple schools can sign up and use the
same application independently. Every school's data is fully isolated from
every other school's — see §2.1 and §6.3.

---

## 2. Core Concepts & Data Model

### 2.0 School (Tenant)
The top-level entity. Every other record in the system (Sessions, Class
Levels, Fee Items, Students, Charges, Payments — everything) belongs to
exactly one School.
- `id`
- `name`
- `address`, `contactEmail`, `contactPhone`
- `createdAt`
- `subscriptionStatus` *(placeholder for future billing, not required in Phase 1)*

**Onboarding flow (sign-up):**
1. School creates an account (school name + admin email/password, or
   equivalent auth method)
2. During setup, the school selects/confirms the **Class Levels** it
   currently runs (from the default seed list — Kindergarten through SS3 —
   with the ability to remove levels the school doesn't have, add custom
   ones, and reorder them)
3. The school can optionally set up Class Arms and Fee Items at this point,
   or skip and configure them later from settings
4. Once setup is complete, the admin logs in on subsequent visits with the
   credentials created at sign-up

Every record created afterward (students, sessions, payments, etc.) is
automatically scoped to that school's `id` — the admin never manually picks
"which school" once logged in; it's implicit from their session.

**Account / User** (the login identity, separate from the School record so
a school could later add more than one staff login):
- `id`
- `schoolId` (tenant this account belongs to)
- `email` / `username`
- `passwordHash`
- `role` (Phase 1: just `admin`)

### 2.0.1 Signup & login flow
1. **Sign up:** admin enters school name, creates a login (email + password),
   and selects which class levels the school currently has. This creates
   the School record and the first Account, both tagged with a new
   `schoolId`.
2. **Login:** email + password → resolves to an Account → resolves to a
   `schoolId` → all subsequent data reads/writes for that session are
   scoped to that `schoolId`.
3. Every screen after login operates only within the logged-in school's
   tenant — there is no cross-school view in Phase 1.

### 2.0.2 Multi-tenancy enforcement (strict isolation)
Tenant isolation is enforced at **every layer**, not just the UI:
- **Data layer:** every table/collection (Students, Classes, Fee Items,
  Charges, Payments, etc.) carries a `schoolId` column. All queries are
  automatically filtered by the logged-in user's `schoolId` — there is no
  code path that queries across tenants.
- **Local storage:** cached/offline data is also namespaced by `schoolId`,
  so two schools' data never mixes even in local device storage.
- **Backend rules:** if using a managed backend (e.g. Supabase), Row-Level
  Security (RLS) policies enforce `schoolId = current user's schoolId` at
  the database level — so even a bug in application code cannot leak data
  between schools, since the database itself refuses the query.
- **No shared identifiers:** admission numbers, class names, etc. are only
  unique *within* a school, never globally — so two schools can both have a
  "Chidi Okafor" or a "SS3 A" with zero collision.

> **Note:** every entity from §2.1 onward includes an implicit `schoolId`
> field tying it to the owning School. This is omitted from each entity's
> field list below for brevity, but is mandatory on every table — see §6.3
> for how this is enforced.

### 2.1 Session
Represents an academic year, e.g. `2025/2026`.
- `id`
- `name` (e.g. "2025/2026")
- `startDate`, `endDate`
- `isActive` (only one session active at a time)
- Contains exactly 3 **Terms**

### 2.2 Term
- `id`
- `sessionId` (parent)
- `name` (Term 1 / Term 2 / Term 3)
- `startDate`, `endDate`

### 2.3 Class Level
Configurable, ordered list representing the school's grade structure.
- `id`
- `name` (e.g. "Kindergarten", "Primary 1", "JSS1", "SS3")
- `order` (integer — used for promotion sequencing and display order)

Default seed list: Kindergarten, Nursery 1, Nursery 2, Primary 1–6, JSS1–3,
SS1–3 — but fully editable (add/remove/rename/reorder) by the admin.

### 2.4 Class Arm
Represents a specific stream within a class level for a given session, e.g.
SS3 A, SS3 B, SS3 C.
- `id`
- `classLevelId`
- `sessionId`
- `name` (A, B, C…)
- Arms are configurable per class level — some levels (e.g. Kindergarten)
  may have only one arm, others (e.g. SS3) may have several.

### 2.5 Fee Item
Configurable list of chargeable items (Admission Form, Uniform, School Fees,
Sportwear, Textbooks, etc.)
- `id`
- `name`
- `type`: `one-off` (charged once, typically at admission) or `recurring`
  (charged every term)
- `appliesTo`: `new-students-only` | `all-students`
- `pricingByClassLevel`: map of `classLevelId → amount` (supports fee items
  that vary by class, e.g. School Fees; a flat item just uses the same
  amount for every class level)

### 2.6 Student
- `id`
- `firstName`, `lastName`, `otherNames`
- `admissionNumber`
- `status`: `new` | `existing`
- `dateOfBirth`, `gender`, `guardianName`, `guardianPhone`, `address` (basic
  bio-data, expandable later)
- `currentClassArmId` (current placement)
- `admissionSessionId` (session they joined in — relevant for one-off fees)
- `enrollmentHistory`: list of `{ sessionId, classLevelId, classArmId }` —
  preserved every time a student is promoted, so historical class placement
  is never lost

### 2.7 Charge
An amount owed by a student for a specific fee item, term, and session.
Auto-generated when:
- A new student is added (one-off fees + current term's recurring fees), or
- A new term starts for an existing student (recurring fees only)
- `id`
- `studentId`
- `feeItemId`
- `sessionId`, `termId`
- `classLevelId` (locks in which price applied, since a student may change
  class level between sessions and prices differ by level)
- `amountExpected`

### 2.8 Payment
- `id`
- `studentId`
- `chargeId` (which charge this payment is applied against)
- `amountPaid`
- `datePaid`
- `method` (cash / bank transfer / POS / other)
- `receiptNumber`
- `recordedBy`

> Payments are linked to a specific **Charge**, not just a student, so
> balances can always be broken down by fee item and by term — this is what
> makes arrears tracking possible (see §3.3).

### 2.9 Guardian / Household
Links siblings together under one parent/guardian contact, so a single
lump-sum payment can be split across multiple children in one action.
- `id`
- `name` (e.g. "Mr. & Mrs. Okafor")
- `phone`, `email`, `address`
- `students`: list of Student IDs linked to this household (a student may
  have zero or one household — not every student has a sibling in the
  school)

### 2.10 Student Note (pinned note)
A short, persistent note attached to a student's profile for information
staff must not forget — informal arrangements, discounts approved
verbally, payment plans, etc.
- `id`
- `studentId`
- `text`
- `createdBy` (which admin/staff account added it)
- `createdAt`
- `pinned` (boolean — pinned notes always show at the top of the profile;
  unpinned ones can be archived/resolved once no longer relevant)

## 3. Key Business Rules

### 3.1 Fee generation
When a student is enrolled or a new term begins, the system auto-generates
**Charges** for that student based on:
- Fee items marked `all-students` (every term, if recurring)
- Fee items marked `new-students-only` (only if the student's status is
  `new`, and only once — typically at admission)
- The price is looked up from the fee item's `pricingByClassLevel` for the
  student's class level **at the time the charge is generated** (price is
  locked into the charge record so later price changes don't retroactively
  alter historical charges)

### 3.2 Balance calculation
For any given Charge: `balance = amountExpected − sum(payments against that charge)`

A student's displayed balance can be viewed at three levels:
1. **Per fee item, per term** (most granular — e.g. "SS3 Term 2 Sportwear: ₦5,000 outstanding")
2. **Per term** (sum of all fee items for that term)
3. **Total arrears across all sessions/terms** (cumulative, all-time outstanding balance)

### 3.3 Arrears across sessions (carry-forward debt)
Charges and payments are never deleted or reset when a student is promoted.
A student in SS3 can therefore still show an outstanding balance from an
SS1 charge. The student profile surfaces:
- **Current term balance**
- **Total outstanding arrears** (all unpaid balances from any past term/session)
- A breakdown table showing which session/term/fee item each arrear
  originates from

**Payment allocation rule:** by default, new payments are applied to the
**oldest outstanding charge first** ("clear old debt before new"). The
admin can override this and manually allocate a payment to a specific
charge (e.g. if a parent specifies "this payment is for this term's fees
only").

### 3.4 Promotion
At the end of a session, the admin runs a **Promotion** action to move a
class arm to the next session. See §3.9 for the full flow, including how
repeaters and withdrawals are handled — this is never an automatic,
silent process.

### 3.5 New vs Existing
- `new` status triggers one-off fee items (e.g. Admission Form) at the point
  of enrollment
- `existing` status skips one-off fees already paid in a prior session
- Status is set once at creation and doesn't need to change afterward (a
  "new" student today is just a normal student going forward — the flag is
  historical, used for that one enrollment)

### 3.6 Lump-sum payments across siblings

**Creating and linking households (at enrollment):** when a new student is
added, the admin enters a guardian phone number. The system searches
existing students for a matching guardian phone:
- **Match found** → the matching student(s) are shown as likely siblings
  (name + class), and the admin can confirm linking the new student to
  that same household with one click — no separate "create household"
  step needed for the common case.
- **No match** → the admin enters the guardian's name, and a new household
  record is created automatically and linked to this one student. It will
  be found automatically the next time a sibling is enrolled with the same
  phone number.
- A household can also be created or edited directly from a student's
  profile after the fact (e.g. adding a sibling relationship the system
  didn't catch because the phone number differed).

**Splitting a payment across the household:**

- When recording a payment, the admin can search by **guardian name or
  phone** instead of a single student. This surfaces every linked child in
  that household along with each one's current outstanding balance.
- The admin enters the total amount received, then splits it across the
  children — either manually (typing an amount per child) or by accepting
  a suggested split proportional to each child's outstanding balance.
- Under the hood, the split still produces **one Payment record per
  student** against their own Charges (so §3.2's balance calculation and
  §3.3's oldest-arrears-first allocation apply exactly as normal, per
  child). The only difference is the entry point and a shared reference
  (e.g. a household transaction ID) linking the split payments together
  for receipt purposes.
- A single receipt can then show the full breakdown by child, and reports
  can optionally roll up "total owed per household" — useful when a bursar
  wants to make one phone call about a family's balance instead of three.

### 3.7 Pinned notes on a student profile
Staff often need to remember informal, non-standard information about a
student's account that doesn't fit into the structured fee/payment data —
e.g. a discount approved verbally by the proprietor, an agreed installment
plan, or a special circumstance. To prevent this information from being
forgotten or lost between staff:

- Any admin can add a short **note** to a student's profile.
- Notes can be **pinned**, which keeps them visibly at the top of the
  student's profile (near the balance summary) so they surface every time
  someone opens that record — particularly relevant when recording a
  payment or discussing balances with a parent.
- Every note records **who added it and when**, so there's accountability
  and a trail if the arrangement is later questioned.
- Notes are informational only — they never automatically change a
  charge or balance. If a discount is agreed, the fee item or charge
  itself should still be adjusted separately; the note is a human-readable
  record of *why*.

---

### 3.8 Writing off a balance (bad debt)
Occasionally a balance needs to be forgiven — a genuine hardship case, a
proprietor-approved exception, a balance too small or old to be worth
pursuing. This must never be modeled as a payment, since no money changed
hands; it needs its own concept so financial reports stay accurate.

- **Write-Off** entity: `id`, `chargeId`, `studentId`, `amount`, `reason`
  (required — the action cannot be completed without one), `writtenOffBy`,
  `date`.
- A write-off reduces a charge's outstanding balance without increasing
  `amountPaid`. Reports that total "collections" must exclude written-off
  amounts, and should ideally report them as a separate line (e.g. "written
  off this term") so the difference between money collected and debt
  forgiven is never blurred.
- A write-off can never exceed the charge's remaining balance.
- Once recorded, a write-off is **permanent and visible on the student's
  record** — it is not editable or deletable, only ever added to. This
  preserves an audit trail: anyone reviewing the account later can see
  exactly what was forgiven, why, by whom, and when.

### 3.9 Promotion, repeaters, and non-automatic progression
Promotion is a **deliberate, admin-triggered action** at the end of a
session — never automatic. Automatically rolling every student to the next
class level would silently mishandle real exceptions: students repeating a
class, students transferring out, and students who withdrew mid-session
but were never formally marked as such.

The promotion flow works at the class-arm level but allows per-student
override:
1. Admin selects a source class arm (e.g. SS2 A) and a session boundary
   (end of current session).
2. The system shows the full roster with a default action of **"Promote to
   [next level, same arm]"** for every student, since that's the common
   case.
3. The admin can override any individual student to **"Repeat this
   class"** (stays in the same class level for the new session, a new
   `enrollmentHistory` entry is still added so the repeat is visible in
   their record) or **"Withdraw / do not carry forward"** (see §3.10).
4. Confirming the batch applies all promotions, repeats, and withdrawals
   in one action, and generates the new session's `enrollmentHistory`
   entries accordingly.
5. As stated in §3.4, historical charges and payments are never affected
   by promotion — a repeating student's prior-term records stay exactly as
   they were.

### 3.10 Standing discounts and waivers
Distinct from a write-off (§3.8, which forgives a balance already charged),
a **discount** is a standing rule that reduces what a student is charged
**going forward** — e.g. a sibling or staff discount that applies every
term until removed.

- **Discount** entity: `id`, `studentId`, `feeItemId`, `type`
  (`percent` or `fixed`), `value`, `reason` (required, same principle as
  write-offs), `appliedBy`, `date`.
- Applied automatically whenever a new charge is generated for that fee
  item (§3.1) — the discount reduces `amountExpected` at generation time,
  so it's baked into the charge itself rather than needing to be
  reapplied manually every term.
- Optionally applied immediately to the current term's already-generated
  charge, if the admin explicitly chooses to (otherwise it only affects
  charges generated from the next term onward).
- Visible permanently on the student's profile, same as write-offs and
  notes — anyone reviewing the account can see why this student is paying
  less than the standard rate.

### 3.11 Student exit / withdrawal
When a student leaves the school (graduates, transfers out, or withdraws
mid-session), the record should never be deleted — it needs to remain
available for historical reference (e.g. a transfer school requesting
records, or the family returning years later) — but it also shouldn't
clutter the active roster, reports, or class lists by default.

- Student gains a `status` beyond `new`/`existing`: **`withdrawn`** (or
  **`graduated`**, treated the same way operationally) with a
  `statusChangedAt` date and an optional reason.
- **Exit checklist**, triggered from the student's profile: before marking
  a student as withdrawn, the admin sees a summary of any outstanding
  balance (current term and arrears) and payment history, so it's a
  deliberate, informed decision — not a silent way to lose track of a debt.
  Marking a student withdrawn does **not** clear or write off any balance;
  it must be handled explicitly (paid, or written off per §3.8) if that's
  the intent.
- Withdrawn/graduated students are **excluded from active views by
  default** — the main student roster, class rosters, the Class Register,
  and defaulter/collection reports — but remain fully searchable and
  viewable via an explicit "show inactive/past students" filter, and their
  profile page keeps functioning identically (balances, history, notes,
  write-offs all still visible).

## 4. Feature List (Phase 1)

- School sign-up / onboarding (create account, select current class levels)
- Admin login, scoped strictly to the school created at sign-up
- Configurable Class Levels and Arms
- Configurable Fee Items (with per-class-level pricing and one-off/recurring rules)
- Session & Term management (create session, auto-generate 3 terms)
- Student CRUD (add/edit/view), with new/existing flag
- Auto-generated charges on enrollment / new term
- Payment recording (against a specific charge, with receipt number)
- Student search → profile view showing:
  - Bio-data & current class
  - **Pinned notes** for important information staff shouldn't forget
  - Current term balance breakdown
  - Total arrears (all-time), with source breakdown
  - Full payment history
- Guardian/household linking (siblings), with lump-sum payment splitting
- Bulk class promotion at session end
- Reports:
  - Outstanding balances by class (defaulters list)
  - Arrears report (students with debt from past sessions)
  - Payment log / daily collections

## 5. Out of Scope (Phase 1)

- Teacher and parent portal access / role-based permissions
- SMS/email payment reminders
- Online payment gateway integration (Paystack/Flutterwave etc.) — payments
  are recorded manually as they're received
- Report cards / academic performance tracking

*(These can be layered on in later phases without changing the core data model.)*

---

## 6. Technical Architecture

### 6.1 Offline-first, cloud-synced
- **Local storage:** all reads/writes happen against a local database on
  the device first (instant, works with no internet)
- **Cloud sync:** a background sync process pushes local changes to a cloud
  database and pulls down changes from other devices, whenever a connection
  is available
- **Conflict resolution:** last-write-wins by default, acceptable given a
  single small office team; a "pending sync" indicator shows unsynced
  records
- Delivered as a **Progressive Web App (PWA)** — installable on
  desktop/mobile from the browser, no app store required, single codebase

### 6.2 Multi-tenancy & data isolation
Strict tenant isolation is a hard requirement — one school must never be
able to see, query, or leak into another school's data.

- Every table/collection carries a mandatory `schoolId`. There is no query
  path in the application that omits filtering by the logged-in admin's
  `schoolId`.
- **Enforcement at the database layer, not just the application layer:**
  row-level security (RLS) rules on the cloud database restrict every read
  and write to rows matching the authenticated user's `schoolId`, so even a
  bug in application code can't leak cross-tenant data.
- **Auth:** each School has exactly **one admin login** in Phase 1 (no
  multi-user accounts per school yet). Login issues a session/token that
  carries the `schoolId`, which the backend uses to scope every request
  automatically. Multiple staff logins per school (e.g. principal + bursar)
  can be added in a later phase without changing the data model — it would
  just mean linking multiple admin accounts to the same `schoolId`.
- **Offline/local storage:** the local database on a given device only ever
  holds data for the school the logged-in user belongs to — no shared local
  cache across tenants, even on a shared device.
- No cross-school reporting or aggregation exists in Phase 1; each school's
  instance is fully self-contained.

### 6.3 Suggested stack
- Frontend: React (PWA-enabled)
- Local storage: IndexedDB (via a wrapper like Dexie.js)
- Backend/cloud DB: a managed service supporting realtime sync (e.g.
  Supabase or Firebase) to minimize custom sync-engine work
- Hosting: any standard static hosting + managed backend (low ops overhead
  for a single-office deployment)

---

## 7. Open Questions for Next Phase

- Should there be a way to issue **discounts/waivers** per student (e.g.
  sibling discount, staff discount)?
- Should printed **receipts** be generated per payment?
- Any requirement to **export** data (e.g. Excel) for external record-keeping
  or auditors?
- Backup/export strategy in case of device loss, beyond cloud sync?
