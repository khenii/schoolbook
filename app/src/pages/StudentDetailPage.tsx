import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import HouseholdSection from '../components/students/HouseholdSection';

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

interface ChargeRow {
  id: string;
  fee_item_id: string;
  session_id: string;
  term_id: string;
  amount_expected: number;
}

interface FeeItemRow {
  id: string;
  name: string;
}

interface TermRow {
  id: string;
  name: string;
}

interface SessionRow {
  id: string;
  name: string;
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const db = usePowerSync();

  const { data: studentRows } = useQuery<StudentRow>('SELECT * FROM students WHERE id = ?', [id ?? '']);
  const student = studentRows[0];

  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name FROM class_levels');
  const { data: charges } = useQuery<ChargeRow>(
    'SELECT id, fee_item_id, session_id, term_id, amount_expected FROM charges WHERE student_id = ?',
    [id ?? '']
  );
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items');
  const { data: terms } = useQuery<TermRow>('SELECT id, name FROM terms');
  const { data: sessions } = useQuery<SessionRow>('SELECT id, name FROM sessions');

  const [form, setForm] = useState<Partial<StudentRow>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (student) setForm(student);
  }, [student?.id]);

  if (!student) {
    return (
      <div style={{ maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }}>
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
    <div style={{ maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }}>
      <p>
        <Link to="/students">← Back to students</Link>
      </p>
      <h1>
        {student.last_name} {student.first_name}
      </h1>
      <p style={{ color: 'var(--color-slate)' }}>
        {student.admission_number} · {armLabel(student.current_class_arm_id)}
      </p>

      <form onSubmit={handleSave} style={{ maxWidth: 'none', margin: 0 }}>
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

      <HouseholdSection student={student} />

      <h2 style={{ marginTop: '2rem' }}>Charges generated at enrollment</h2>
      <p style={{ fontSize: 12, color: '#888' }}>
        Balance, arrears, and payment history will show here properly once the full student profile (task #18) is
        built — this is just a raw list to confirm charge generation worked.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={{ padding: 8 }}>Fee item</th>
            <th style={{ padding: 8 }}>Session</th>
            <th style={{ padding: 8 }}>Term</th>
            <th style={{ padding: 8 }}>Amount expected</th>
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }} title={`fee_item_id: ${c.fee_item_id}`}>
                {feeItems.find((f) => f.id === c.fee_item_id)?.name ?? c.fee_item_id}
              </td>
              <td style={{ padding: 8 }}>{sessions.find((s) => s.id === c.session_id)?.name ?? c.session_id}</td>
              <td style={{ padding: 8 }}>{terms.find((t) => t.id === c.term_id)?.name ?? c.term_id}</td>
              <td style={{ padding: 8 }}>₦{c.amount_expected.toLocaleString()}</td>
            </tr>
          ))}
          {charges.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 8, color: '#888' }}>
                No charges.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
