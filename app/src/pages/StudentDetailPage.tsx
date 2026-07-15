import { Fragment, useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useStudentLedger } from '../hooks/useStudentLedger';
import HouseholdSection from '../components/students/HouseholdSection';
import PaymentSection from '../components/students/PaymentSection';
import ProfileSummary from '../components/students/ProfileSummary';
import NotesSection from '../components/students/NotesSection';
import PaymentHistorySection from '../components/students/PaymentHistorySection';

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  admission_number: string;
  status: string;
  date_of_birth: string | null;
  gender: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  address: string | null;
  current_class_arm_id: string | null;
  household_id: string | null;
}

interface ClassArmRow {
  id: string;
  class_level_id: string;
  name: string;
}

interface ClassLevelRow {
  id: string;
  name: string;
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const db = usePowerSync();
  const { account } = useAppContext();
  const studentId = id ?? '';

  const { data: studentRows } = useQuery<StudentRow>('SELECT * FROM students WHERE id = ?', [studentId]);
  const student = studentRows[0];

  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name FROM class_levels');
  const { charges } = useStudentLedger(studentId);

  const [form, setForm] = useState<Partial<StudentRow>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [writeOffChargeId, setWriteOffChargeId] = useState<string | null>(null);
  const [writeOffAmount, setWriteOffAmount] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffSaving, setWriteOffSaving] = useState(false);
  const [writeOffError, setWriteOffError] = useState<string | null>(null);

  function startWriteOff(chargeId: string, balance: number) {
    setWriteOffChargeId(chargeId);
    setWriteOffAmount(String(balance));
    setWriteOffReason('');
    setWriteOffError(null);
  }

  function cancelWriteOff() {
    setWriteOffChargeId(null);
    setWriteOffAmount('');
    setWriteOffReason('');
    setWriteOffError(null);
  }

  async function confirmWriteOff(chargeId: string, balance: number) {
    const amount = Number(writeOffAmount);
    if (!amount || amount <= 0) {
      setWriteOffError('Enter an amount greater than zero.');
      return;
    }
    if (amount > balance) {
      setWriteOffError(`Exceeds this charge's outstanding balance (₦${balance.toLocaleString()}).`);
      return;
    }
    if (!writeOffReason.trim()) {
      setWriteOffError('A reason is required — this is a permanent record.');
      return;
    }
    setWriteOffSaving(true);
    try {
      await db.execute(
        `INSERT INTO write_offs (id, school_id, charge_id, student_id, amount, reason, written_off_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          account.school_id,
          chargeId,
          studentId,
          amount,
          writeOffReason.trim(),
          account.id,
          new Date().toISOString()
        ]
      );
      cancelWriteOff();
    } catch (err) {
      setWriteOffError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setWriteOffSaving(false);
    }
  }

  useEffect(() => {
    if (student) setForm(student);
  }, [student?.id]);

  if (!student) {
    return (
      <div style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
        <p>
          <Link to="/students">← Back to students</Link>
        </p>
        <p>Loading, or this student doesn't exist.</p>
      </div>
    );
  }

  const armLabel = (armId: string | null) => {
    if (!armId) return '—';
    const arm = arms.find((a) => a.id === armId);
    if (!arm) return '—';
    const level = levels.find((l) => l.id === arm.class_level_id);
    return `${level?.name ?? ''} ${arm.name}`.trim();
  };

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await db.execute(
      `UPDATE students SET
         first_name = ?, last_name = ?, other_names = ?, guardian_name = ?, guardian_phone = ?,
         address = ?, gender = ?, date_of_birth = ?, status = ?
       WHERE id = ?`,
      [
        form.first_name ?? student.first_name,
        form.last_name ?? student.last_name,
        form.other_names ?? null,
        form.guardian_name ?? null,
        form.guardian_phone ?? null,
        form.address ?? null,
        form.gender ?? null,
        form.date_of_birth ?? null,
        form.status ?? student.status,
        student.id
      ]
    );
    setSaving(false);
    setSaved(true);
  }

  return (
    <div style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <p>
        <Link to="/students">← Back to students</Link>
      </p>
      <h1>
        {student.last_name} {student.first_name}
      </h1>
      <p style={{ color: 'var(--color-slate)' }}>
        {student.admission_number} · {armLabel(student.current_class_arm_id)} · {student.status}
      </p>

      <ProfileSummary studentId={student.id} />
      <NotesSection studentId={student.id} />

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit bio-data</summary>
        <form onSubmit={handleSave} style={{ maxWidth: 'none', margin: '0.75rem 0 0' }}>
          <input
            placeholder="First name"
            value={form.first_name ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
          />
          <input
            placeholder="Last name"
            value={form.last_name ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
          />
          <input
            placeholder="Other names"
            value={form.other_names ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, other_names: e.target.value }))}
          />
          <input
            placeholder="Guardian name"
            value={form.guardian_name ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, guardian_name: e.target.value }))}
          />
          <input
            placeholder="Guardian phone"
            value={form.guardian_phone ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, guardian_phone: e.target.value }))}
          />
          <input
            placeholder="Address"
            value={form.address ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
          <select
            value={form.status ?? student.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="new">New</option>
            <option value="existing">Existing</option>
          </select>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && <span style={{ color: 'green', marginLeft: 8 }}>Saved.</span>}
        </form>
      </details>

      <HouseholdSection student={student} />

      <h2 style={{ marginTop: '2rem' }}>All charges</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={{ padding: 8 }}>Fee item</th>
            <th style={{ padding: 8 }}>Session</th>
            <th style={{ padding: 8 }}>Term</th>
            <th style={{ padding: 8 }}>Expected</th>
            <th style={{ padding: 8 }}>Paid</th>
            <th style={{ padding: 8 }}>Written off</th>
            <th style={{ padding: 8 }}>Balance</th>
            <th style={{ padding: 8 }} />
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <Fragment key={c.id}>
              <tr style={{ borderBottom: writeOffChargeId === c.id ? 'none' : '1px solid #eee' }}>
                <td style={{ padding: 8 }} title={`fee_item_id: ${c.fee_item_id}`}>
                  {c.feeItemName}
                </td>
                <td style={{ padding: 8 }}>{c.sessionName}</td>
                <td style={{ padding: 8 }}>{c.termName}</td>
                <td style={{ padding: 8 }}>₦{c.amount_expected.toLocaleString()}</td>
                <td style={{ padding: 8 }}>₦{c.paid.toLocaleString()}</td>
                <td style={{ padding: 8, color: c.writtenOff > 0 ? '#b8860b' : 'inherit' }}>
                  {c.writtenOff > 0 ? `₦${c.writtenOff.toLocaleString()}` : '—'}
                </td>
                <td style={{ padding: 8, color: c.balance > 0 ? 'crimson' : 'inherit' }}>
                  ₦{c.balance.toLocaleString()}
                </td>
                <td style={{ padding: 8 }}>
                  {c.balance > 0 && writeOffChargeId !== c.id && (
                    <button onClick={() => startWriteOff(c.id, c.balance)} style={{ fontSize: 11 }}>
                      Write off
                    </button>
                  )}
                </td>
              </tr>
              {writeOffChargeId === c.id && (
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td colSpan={8} style={{ padding: '0 8px 10px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="number"
                        value={writeOffAmount}
                        onChange={(e) => setWriteOffAmount(e.target.value)}
                        style={{ width: 110 }}
                      />
                      <input
                        placeholder="Reason (required)"
                        value={writeOffReason}
                        onChange={(e) => setWriteOffReason(e.target.value)}
                        style={{ flex: 1, minWidth: 200 }}
                      />
                      <button onClick={() => confirmWriteOff(c.id, c.balance)} disabled={writeOffSaving}>
                        {writeOffSaving ? 'Saving…' : 'Confirm write-off'}
                      </button>
                      <button type="button" onClick={cancelWriteOff}>
                        Cancel
                      </button>
                    </div>
                    {writeOffError && <p style={{ color: 'crimson', fontSize: 12, margin: '4px 0 0' }}>{writeOffError}</p>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {charges.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: 8, color: '#888' }}>
                No charges.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <PaymentHistorySection studentId={student.id} />
      <PaymentSection studentId={student.id} />
    </div>
  );
}
