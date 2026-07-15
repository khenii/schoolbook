import { useMemo, useRef, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import AppShell from '../components/AppShell';
import { useAppContext } from '../lib/AppContext';
import { useActiveSession } from '../hooks/useActiveSession';
import { exportToCSV } from '../lib/csv';
import { linkStudentsToHousehold, normalizePhone } from '../lib/households';
import { logAudit } from '../lib/auditLog';
import {
  STUDENTS_HEADERS,
  STUDENTS_TEMPLATE_EXAMPLE,
  CHARGES_PAYMENTS_HEADERS,
  CHARGES_PAYMENTS_TEMPLATE_EXAMPLE,
  parseStudentsCSV,
  parseChargesPaymentsCSV
} from '../lib/import';
import type { ParsedStudentRow, ParsedChargePaymentRow, RowError } from '../lib/import';

type Tab = 'students' | 'charges';

// No mockup covers Import (task #48) — Phase 5 added it after the 12
// mockups were delivered. Styled from the same tokens/components as every
// other page rather than left in its pre-restyle ad hoc state: .panel-block
// from the dashboard for each of the two upload panels, .mode-toggle (from
// the Payments record panel) for the Students/Charges switch instead of
// inventing a new tab style, and .allocation-note (from Student
// Profile/Payments) for the error and success banners, tinted rust/success.
export default function ImportPage() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;
  const { session: activeSession } = useActiveSession();

  const [tab, setTab] = useState<Tab>('students');

  return (
    <AppShell title="Import" pageClass="page-import">
      <div className="page-head">
        <div className="eyebrow">Configuration</div>
        <h2>Bulk import</h2>
        <p>
          No digital records to upload from? Download a template, fill it in from your paper ledgers at your own
          pace, then import the finished file here. Safe to import in batches — already-imported rows are
          automatically skipped, so re-running the same file (or a growing version of it) won't create duplicates.
        </p>
      </div>

      <div className="mode-toggle" style={{ width: 420, marginBottom: 20 }}>
        <div className={tab === 'students' ? 'sel' : ''} onClick={() => setTab('students')}>
          1. Students
        </div>
        <div className={tab === 'charges' ? 'sel' : ''} onClick={() => setTab('charges')}>
          2. Charges &amp; Payments
        </div>
      </div>

      {tab === 'students' ? (
        <StudentsImportPanel
          db={db}
          schoolId={schoolId}
          accountId={account.id}
          activeSessionId={activeSession?.id ?? null}
        />
      ) : (
        <ChargesPaymentsImportPanel db={db} schoolId={schoolId} accountId={account.id} />
      )}
    </AppShell>
  );
}

function ErrorList({ errors }: { errors: RowError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="allocation-note" style={{ borderColor: 'var(--rust)', background: 'var(--rust-bg)', marginTop: 10 }}>
      <strong style={{ fontSize: 12.5, color: 'var(--rust)' }}>
        {errors.length} row{errors.length === 1 ? '' : 's'} couldn't be imported:
      </strong>
      <ul style={{ margin: '6px 0 0 18px', fontSize: 12, color: 'var(--rust)', maxHeight: 220, overflowY: 'auto' }}>
        {errors.map((e, i) => (
          <li key={i}>
            Row {e.row}: {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StudentsImportPanel({
  db,
  schoolId,
  accountId,
  activeSessionId
}: {
  db: ReturnType<typeof usePowerSync>;
  schoolId: string;
  accountId: string;
  activeSessionId: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ valid: ParsedStudentRow[]; errors: RowError[]; skipped: { row: number; admissionNumber: string }[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const { data: existingStudents } = useQuery<{ admission_number: string; guardian_phone: string | null; id: string }>(
    'SELECT id, admission_number, guardian_phone FROM students'
  );
  const { data: levels } = useQuery<{ id: string; name: string }>('SELECT id, name FROM class_levels');
  const { data: arms } = useQuery<{ id: string; class_level_id: string; name: string }>(
    'SELECT id, class_level_id, name FROM class_arms WHERE session_id = ?',
    [activeSessionId ?? '']
  );

  const existingAdmissionNumbers = useMemo(
    () => new Set(existingStudents.map((s) => s.admission_number.trim().toLowerCase())),
    [existingStudents]
  );

  function downloadTemplate() {
    exportToCSV('students-import-template.csv', STUDENTS_HEADERS, [STUDENTS_TEMPLATE_EXAMPLE]);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const text = await file.text();
    setParsed(parseStudentsCSV(text, { existingAdmissionNumbers, levels, arms }));
  }

  async function handleImport() {
    if (!parsed || parsed.valid.length === 0 || !activeSessionId) return;
    setImporting(true);
    try {
      const now = new Date().toISOString();

      await db.writeTransaction(async (tx) => {
        const insertedIds: { id: string; row: ParsedStudentRow }[] = [];

        for (const row of parsed.valid) {
          const studentId = crypto.randomUUID();
          await tx.execute(
            `INSERT INTO students
               (id, school_id, first_name, last_name, other_names, admission_number, status, date_of_birth, gender,
                guardian_name, guardian_phone, address, current_class_arm_id, admission_session_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              studentId,
              schoolId,
              row.firstName,
              row.lastName,
              row.otherNames,
              row.admissionNumber,
              row.status,
              row.dateOfBirth,
              row.gender,
              row.guardianName,
              row.guardianPhone,
              row.address,
              row.classArmId,
              activeSessionId,
              now
            ]
          );
          await tx.execute(
            `INSERT INTO enrollment_history
               (id, school_id, student_id, session_id, class_level_id, class_arm_id, type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'initial', ?)`,
            [crypto.randomUUID(), schoolId, studentId, activeSessionId, row.classLevelId, row.classArmId, now]
          );
          insertedIds.push({ id: studentId, row });
        }

        // Link siblings by guardian phone — both within this batch and
        // against students already on file — same matching rule as the
        // single-student Add Student flow (spec §3.6).
        const groups = new Map<string, { studentIds: string[]; name: string; phone: string }>();
        for (const { id, row } of insertedIds) {
          if (!row.guardianPhone) continue;
          const key = normalizePhone(row.guardianPhone);
          if (!key) continue;
          const g = groups.get(key) ?? { studentIds: [], name: row.guardianName ?? '', phone: row.guardianPhone };
          g.studentIds.push(id);
          groups.set(key, g);
        }
        for (const existing of existingStudents) {
          if (!existing.guardian_phone) continue;
          const key = normalizePhone(existing.guardian_phone);
          const g = groups.get(key);
          if (g) g.studentIds.push(existing.id);
        }
        for (const g of groups.values()) {
          if (g.studentIds.length < 2) continue;
          await linkStudentsToHousehold(tx, {
            schoolId,
            studentIds: g.studentIds,
            fallbackName: g.name,
            fallbackPhone: g.phone
          });
        }

        await logAudit(tx, {
          schoolId,
          actorId: accountId,
          action: 'import.students',
          entityType: 'student',
          metadata: { count: insertedIds.length, admissionNumbers: insertedIds.map((r) => r.row.admissionNumber) }
        });
      });

      setResult(
        `Imported ${parsed.valid.length} student${parsed.valid.length === 1 ? '' : 's'}. Use Settings → Sessions → "Generate recurring charges" to bill them for the current term, or the Charges & Payments template to set exact historical amounts.`
      );
      setParsed(null);
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="panel-block">
      <div className="panel-block-head">
        <h3>Students</h3>
      </div>
      <div className="panel-block-body">
        <p style={{ fontSize: 12.5, color: 'var(--slate-soft)', lineHeight: 1.55 }}>
          Class Level and Arm must match what's configured in Settings for the currently active session — new
          students from this import land there. Status defaults to "Existing" if left blank.
        </p>
        {!activeSessionId && (
          <p className="field-error" style={{ display: 'block' }}>
            No active session — set one up in Settings first.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '14px 0' }}>
          <button className="btn-ghost" onClick={downloadTemplate}>
            Download template
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} />
        </div>

        {parsed && (
          <>
            <div className="result-count">
              {parsed.valid.length} ready to import
              {parsed.skipped.length > 0 && `, ${parsed.skipped.length} already on file (skipped)`}
              {parsed.errors.length > 0 && `, ${parsed.errors.length} with errors`}
            </div>
            <ErrorList errors={parsed.errors} />
            {parsed.valid.length > 0 && (
              <button
                className="btn-primary"
                onClick={handleImport}
                disabled={importing || !activeSessionId}
                style={{ marginTop: 12 }}
              >
                {importing ? 'Importing…' : `Import ${parsed.valid.length} student${parsed.valid.length === 1 ? '' : 's'}`}
              </button>
            )}
          </>
        )}
        {result && (
          <div className="allocation-note" style={{ borderColor: 'var(--success)', background: 'var(--success-bg)', color: 'var(--success)', marginTop: 12 }}>
            {result}
          </div>
        )}
      </div>
    </div>
  );
}

function ChargesPaymentsImportPanel({
  db,
  schoolId,
  accountId
}: {
  db: ReturnType<typeof usePowerSync>;
  schoolId: string;
  accountId: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{
    valid: ParsedChargePaymentRow[];
    errors: RowError[];
    skipped: { row: number; admissionNumber: string }[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const { data: students } = useQuery<{ id: string; admission_number: string }>(
    'SELECT id, admission_number FROM students'
  );
  const { data: sessions } = useQuery<{ id: string; name: string }>('SELECT id, name FROM sessions');
  const { data: terms } = useQuery<{ id: string; session_id: string; name: string }>(
    'SELECT id, session_id, name FROM terms'
  );
  const { data: feeItems } = useQuery<{ id: string; name: string }>('SELECT id, name FROM fee_items');
  const { data: levels } = useQuery<{ id: string; name: string }>('SELECT id, name FROM class_levels');
  const { data: existingCharges } = useQuery<{ student_id: string; fee_item_id: string; term_id: string }>(
    'SELECT student_id, fee_item_id, term_id FROM charges'
  );

  const studentByAdmissionNumber = useMemo(
    () => new Map(students.map((s) => [s.admission_number.trim().toLowerCase(), s])),
    [students]
  );
  const existingChargeKeys = useMemo(
    () => new Set(existingCharges.map((c) => `${c.student_id}:${c.fee_item_id}:${c.term_id}`)),
    [existingCharges]
  );

  function downloadTemplate() {
    exportToCSV('charges-payments-import-template.csv', CHARGES_PAYMENTS_HEADERS, [CHARGES_PAYMENTS_TEMPLATE_EXAMPLE]);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const text = await file.text();
    setParsed(
      parseChargesPaymentsCSV(text, { studentByAdmissionNumber, sessions, terms, feeItems, levels, existingChargeKeys })
    );
  }

  async function handleImport() {
    if (!parsed || parsed.valid.length === 0) return;
    setImporting(true);
    try {
      const now = new Date().toISOString();
      let paymentCount = 0;

      await db.writeTransaction(async (tx) => {
        for (const row of parsed.valid) {
          const chargeId = crypto.randomUUID();
          await tx.execute(
            `INSERT INTO charges
               (id, school_id, student_id, fee_item_id, session_id, term_id, class_level_id, amount_expected, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [chargeId, schoolId, row.studentId, row.feeItemId, row.sessionId, row.termId, row.classLevelId, row.amountExpected, now]
          );
          if (row.amountPaid > 0) {
            await tx.execute(
              `INSERT INTO payments
                 (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(),
                schoolId,
                row.studentId,
                chargeId,
                row.amountPaid,
                row.datePaid,
                row.method,
                row.receiptNumber,
                accountId,
                now
              ]
            );
            paymentCount++;
          }
        }

        await logAudit(tx, {
          schoolId,
          actorId: accountId,
          action: 'import.charges_payments',
          entityType: 'charge',
          metadata: { chargeCount: parsed.valid.length, paymentCount }
        });
      });

      setResult(
        `Imported ${parsed.valid.length} historical charge${parsed.valid.length === 1 ? '' : 's'} (${paymentCount} with a payment attached).`
      );
      setParsed(null);
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="panel-block">
      <div className="panel-block-head">
        <h3>Historical Charges &amp; Payments</h3>
      </div>
      <div className="panel-block-body">
        <p style={{ fontSize: 12.5, color: 'var(--slate-soft)', lineHeight: 1.55 }}>
          One row per fee item per student per term. Each row creates a charge for the exact amount from the paper
          ledger — not today's fee pricing — and, if an amount was paid, a matching payment record. Session, Term,
          Fee Item, and Class Level must already exist (Settings), and the student must already be imported.
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '14px 0' }}>
          <button className="btn-ghost" onClick={downloadTemplate}>
            Download template
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} />
        </div>

        {parsed && (
          <>
            <div className="result-count">
              {parsed.valid.length} ready to import
              {parsed.skipped.length > 0 && `, ${parsed.skipped.length} already on file (skipped)`}
              {parsed.errors.length > 0 && `, ${parsed.errors.length} with errors`}
            </div>
            <ErrorList errors={parsed.errors} />
            {parsed.valid.length > 0 && (
              <button className="btn-primary" onClick={handleImport} disabled={importing} style={{ marginTop: 12 }}>
                {importing ? 'Importing…' : `Import ${parsed.valid.length} row${parsed.valid.length === 1 ? '' : 's'}`}
              </button>
            )}
          </>
        )}
        {result && (
          <div className="allocation-note" style={{ borderColor: 'var(--success)', background: 'var(--success-bg)', color: 'var(--success)', marginTop: 12 }}>
            {result}
          </div>
        )}
      </div>
    </div>
  );
}
