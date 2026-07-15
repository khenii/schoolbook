import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useActiveSession } from '../hooks/useActiveSession';
import { generateChargesForNewStudent } from '../lib/charges';
import { linkStudentsToHousehold, normalizePhone } from '../lib/households';

interface TermRow {
  id: string;
  name: string;
}

interface ClassArmRow {
  id: string;
  class_level_id: string;
  name: string;
}

interface ClassLevelRow {
  id: string;
  name: string;
  sort_order: number;
}

export default function AddStudentPage() {
  const db = usePowerSync();
  const navigate = useNavigate();
  const { account } = useAppContext();
  const schoolId = account.school_id;
  const { session: activeSession } = useActiveSession();

  const { data: terms } = useQuery<TermRow>(
    'SELECT id, name FROM terms WHERE session_id = ? ORDER BY created_at ASC',
    [activeSession?.id ?? '']
  );
  const { data: arms } = useQuery<ClassArmRow>(
    'SELECT id, class_level_id, name FROM class_arms WHERE session_id = ? ORDER BY name ASC',
    [activeSession?.id ?? '']
  );
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name, sort_order FROM class_levels ORDER BY sort_order ASC');
  const { data: studentsWithPhone } = useQuery<{
    id: string;
    first_name: string;
    last_name: string;
    guardian_phone: string | null;
    current_class_arm_id: string | null;
  }>('SELECT id, first_name, last_name, guardian_phone, current_class_arm_id FROM students WHERE guardian_phone IS NOT NULL');

  const levelName = (id: string) => levels.find((l) => l.id === id)?.name ?? '';
  const sortedArms = [...arms].sort((a, b) => {
    const la = levels.find((l) => l.id === a.class_level_id)?.sort_order ?? 0;
    const lb = levels.find((l) => l.id === b.class_level_id)?.sort_order ?? 0;
    return la - lb || a.name.localeCompare(b.name);
  });

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [otherNames, setOtherNames] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [status, setStatus] = useState<'new' | 'existing'>('new');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [address, setAddress] = useState('');
  const [classArmId, setClassArmId] = useState('');
  const [termId, setTermId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkAsHousehold, setLinkAsHousehold] = useState(true);

  const effectiveTermId = termId || terms[0]?.id || '';
  const effectiveArmId = classArmId || sortedArms[0]?.id || '';

  // Live sibling search per spec §3.6 — as the guardian phone is typed,
  // check for existing students sharing the same number (digits-only
  // comparison, so formatting differences don't cause a missed match).
  const siblingMatches = useMemo(() => {
    const normalized = normalizePhone(guardianPhone);
    if (!normalized) return [];
    return studentsWithPhone.filter((s) => s.guardian_phone && normalizePhone(s.guardian_phone) === normalized);
  }, [guardianPhone, studentsWithPhone]);

  const siblingLabel = (armId: string | null) => {
    if (!armId) return '';
    const arm = arms.find((a) => a.id === armId);
    if (!arm) return '';
    return ` (${levelName(arm.class_level_id)} ${arm.name})`;
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeSession) {
      setError('No active session — set one up in Settings first.');
      return;
    }
    if (!effectiveArmId) {
      setError('No class arms available for this session — add some in Settings first.');
      return;
    }
    if (!effectiveTermId) {
      setError('No term available for this session.');
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !admissionNumber.trim()) {
      setError('First name, last name, and admission number are required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const arm = sortedArms.find((a) => a.id === effectiveArmId)!;
      const studentId = crypto.randomUUID();
      const now = new Date().toISOString();

      let chargeCount = 0;
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO students
             (id, school_id, first_name, last_name, other_names, admission_number, status, date_of_birth, gender,
              guardian_name, guardian_phone, address, current_class_arm_id, admission_session_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentId,
            schoolId,
            firstName.trim(),
            lastName.trim(),
            otherNames.trim() || null,
            admissionNumber.trim(),
            status,
            dateOfBirth || null,
            gender || null,
            guardianName.trim() || null,
            guardianPhone.trim() || null,
            address.trim() || null,
            arm.id,
            activeSession.id,
            now
          ]
        );

        await tx.execute(
          `INSERT INTO enrollment_history
             (id, school_id, student_id, session_id, class_level_id, class_arm_id, type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'initial', ?)`,
          [crypto.randomUUID(), schoolId, studentId, activeSession.id, arm.class_level_id, arm.id, now]
        );

        if (guardianPhone.trim() && linkAsHousehold) {
          const siblingIds = siblingMatches.map((s) => s.id);
          await linkStudentsToHousehold(tx, {
            schoolId,
            studentIds: [studentId, ...siblingIds],
            fallbackName: guardianName,
            fallbackPhone: guardianPhone
          });
        }

        chargeCount = await generateChargesForNewStudent(tx, {
          schoolId,
          studentId,
          classLevelId: arm.class_level_id,
          sessionId: activeSession.id,
          termId: effectiveTermId,
          isNewStudent: status === 'new'
        });
      });

      navigate('/students', { state: { justAdded: `${firstName} ${lastName}`, chargeCount } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }}>
      <p>
        <Link to="/students">← Back to students</Link>
      </p>
      <h1>Add student</h1>

      {!activeSession && <p style={{ color: 'crimson' }}>No active session — set one up in Settings first.</p>}
      {activeSession && sortedArms.length === 0 && (
        <p style={{ color: 'crimson' }}>No class arms configured for this session yet — add some in Settings.</p>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: 'none', margin: 0 }}>
        <input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        <input placeholder="Other names (optional)" value={otherNames} onChange={(e) => setOtherNames(e.target.value)} />
        <input
          placeholder="Admission number"
          value={admissionNumber}
          onChange={(e) => setAdmissionNumber(e.target.value)}
          required
        />

        <div style={{ display: 'flex', gap: 16, margin: '0.5rem 0' }}>
          <label>
            <input type="radio" checked={status === 'new'} onChange={() => setStatus('new')} /> New student
          </label>
          <label>
            <input type="radio" checked={status === 'existing'} onChange={() => setStatus('existing')} /> Existing
            student
          </label>
        </div>

        <label style={{ fontSize: 12, color: '#888' }}>Date of birth</label>
        <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />

        <input placeholder="Gender (optional)" value={gender} onChange={(e) => setGender(e.target.value)} />
        <input placeholder="Guardian name" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
        <input
          placeholder="Guardian phone"
          value={guardianPhone}
          onChange={(e) => setGuardianPhone(e.target.value)}
        />

        {siblingMatches.length > 0 && (
          <div
            style={{
              border: '1px solid var(--color-gold)',
              borderRadius: 8,
              padding: 10,
              margin: '0.5rem 0',
              fontSize: 13
            }}
          >
            <div>
              Possible sibling{siblingMatches.length > 1 ? 's' : ''} found — same guardian phone:
              <ul style={{ margin: '4px 0 8px 18px' }}>
                {siblingMatches.map((s) => (
                  <li key={s.id}>
                    {s.first_name} {s.last_name}
                    {siblingLabel(s.current_class_arm_id)}
                  </li>
                ))}
              </ul>
            </div>
            <label>
              <input
                type="checkbox"
                checked={linkAsHousehold}
                onChange={(e) => setLinkAsHousehold(e.target.checked)}
              />{' '}
              Link this student to the same household
            </label>
          </div>
        )}

        <input placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />

        <label style={{ fontSize: 12, color: '#888' }}>Class arm</label>
        <select value={effectiveArmId} onChange={(e) => setClassArmId(e.target.value)}>
          {sortedArms.map((a) => (
            <option key={a.id} value={a.id}>
              {levelName(a.class_level_id)} {a.name}
            </option>
          ))}
        </select>

        <label style={{ fontSize: 12, color: '#888' }}>Enrolling term (for charge generation)</label>
        <select value={effectiveTermId} onChange={(e) => setTermId(e.target.value)}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Add student'}
        </button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </form>
    </div>
  );
}
