import { useEffect, useMemo, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { useActiveSession } from '../../hooks/useActiveSession';
import { generateChargesForNewStudent } from '../../lib/charges';
import { linkStudentsToHousehold, normalizePhone } from '../../lib/households';
import { logAudit } from '../../lib/auditLog';

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

interface FeeItemRow {
  id: string;
  name: string;
  type: 'one-off' | 'recurring';
  applies_to: 'new-students-only' | 'all-students';
}

interface FeeItemPricingRow {
  fee_item_id: string;
  class_level_id: string;
  amount: number;
}

// "The Lords Army Academy" -> "TLAA". Every word's first letter, uppercased
// — no stopword filtering, since a short school name like "The Grange
// School" losing its "T" would make the prefix less recognizable, not more.
function schoolInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const GENDER_OPTIONS = ['Female', 'Male'];

// The slide-over "Add student" panel from 04-students.html — mounted on
// StudentsPage rather than a standalone route, so saving lands you right
// back on the roster with the new student visible. Absorbs everything
// AddStudentPage used to do: household/sibling matching, charge
// generation, and audit logging, plus a live charge preview the old
// full-page form didn't have.
export default function AddStudentPanel({
  open,
  onClose,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (name: string, chargeCount: number) => void;
}) {
  const db = usePowerSync();
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
  const { data: levels } = useQuery<ClassLevelRow>(
    'SELECT id, name, sort_order FROM class_levels ORDER BY sort_order ASC'
  );
  const { data: studentsWithPhone } = useQuery<{
    id: string;
    first_name: string;
    last_name: string;
    guardian_phone: string | null;
    current_class_arm_id: string | null;
  }>(
    'SELECT id, first_name, last_name, guardian_phone, current_class_arm_id FROM students WHERE guardian_phone IS NOT NULL'
  );
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name, type, applies_to FROM fee_items');
  const { data: pricing } = useQuery<FeeItemPricingRow>(
    'SELECT fee_item_id, class_level_id, amount FROM fee_item_pricing'
  );
  const { data: schoolRows } = useQuery<{ name: string }>('SELECT name FROM schools WHERE id = ?', [schoolId]);
  const schoolName = schoolRows[0]?.name ?? '';
  const { data: admissionNumberRows } = useQuery<{ admission_number: string }>(
    'SELECT admission_number FROM students'
  );

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
  const effectiveArm = sortedArms.find((a) => a.id === effectiveArmId) ?? null;

  // Suggests the next sequential number for this school's prefix (e.g.
  // "TLAA-001", "TLAA-002", ...) by scanning existing admission numbers for
  // the highest one already using that prefix. Pre-fills the field below but
  // stays fully editable — staff can override for a special case, and this
  // recomputes each time the panel is (re)opened rather than being fixed at
  // mount, so it stays current as students get added.
  const nextAdmissionNumber = useMemo(() => {
    const prefix = schoolInitials(schoolName);
    if (!prefix) return '';
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    let max = 0;
    for (const row of admissionNumberRows) {
      const match = pattern.exec(row.admission_number ?? '');
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }, [schoolName, admissionNumberRows]);

  // Auto-fill on open, but only while the field is still untouched — never
  // clobbers something staff already typed, and re-fires once the school
  // name / admission numbers query resolves if that happens after `open`
  // flips true.
  useEffect(() => {
    if (open && !admissionNumber && nextAdmissionNumber) {
      setAdmissionNumber(nextAdmissionNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nextAdmissionNumber]);

  // Postgres already rejects a genuine duplicate at (school_id,
  // admission_number) — that constraint has been in the schema since Phase
  // 0. What it can't do is warn *before* a save is attempted, which matters
  // for an offline-first app: a rejected write just sits queued/retrying
  // rather than failing loudly in front of whoever's typing. This checks the
  // same local data the suggestion above reads from, so a collision (e.g.
  // two offline devices both proposing TLAA-014 before either has synced)
  // is caught immediately on this device instead of surfacing later as a
  // silent stuck sync.
  const admissionNumberTaken = useMemo(() => {
    const trimmed = admissionNumber.trim().toLowerCase();
    if (!trimmed) return false;
    return admissionNumberRows.some((row) => (row.admission_number ?? '').trim().toLowerCase() === trimmed);
  }, [admissionNumber, admissionNumberRows]);

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

  // Live charge preview — mirrors generateChargesForNewStudent's rules
  // exactly (applies_to + status) but read-only, so staff see what will be
  // charged before committing. A new student never has a discount on file
  // yet, so pricing is always the plain fee-item price here.
  const chargePreview = useMemo(() => {
    if (!effectiveArm) return [];
    return feeItems
      .filter((f) => f.applies_to === 'all-students' || (f.applies_to === 'new-students-only' && status === 'new'))
      .map((f) => ({
        ...f,
        amount: pricing.find((p) => p.fee_item_id === f.id && p.class_level_id === effectiveArm.class_level_id)?.amount ?? 0
      }));
  }, [feeItems, pricing, effectiveArm, status]);
  const chargeTotal = chargePreview.reduce((sum, f) => sum + f.amount, 0);

  function reset() {
    setFirstName('');
    setLastName('');
    setOtherNames('');
    setAdmissionNumber('');
    setStatus('new');
    setDateOfBirth('');
    setGender('');
    setGuardianName('');
    setGuardianPhone('');
    setAddress('');
    setClassArmId('');
    setTermId('');
    setError(null);
    setLinkAsHousehold(true);
  }

  async function handleSubmit() {
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
    if (admissionNumberTaken) {
      setError('That admission number is already in use — pick a different one.');
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

        await logAudit(tx, {
          schoolId,
          actorId: account.id,
          action: 'student.enrolled',
          entityType: 'student',
          entityId: studentId,
          metadata: {
            name: `${firstName.trim()} ${lastName.trim()}`,
            admissionNumber: admissionNumber.trim(),
            status,
            chargeCount
          }
        });
      });

      const savedName = `${firstName.trim()} ${lastName.trim()}`;
      reset();
      onSaved(savedName, chargeCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={`overlay${open ? ' show' : ''}`} onClick={onClose} />
      <div className={`panel${open ? ' show' : ''}`}>
        <div className="panel-head">
          <div>
            <h3>Add student</h3>
            <p>Charges below update automatically as you set status and class.</p>
          </div>
          <div className="panel-close" onClick={onClose}>
            ✕
          </div>
        </div>
        <div className="panel-body">
          {!activeSession && (
            <p className="field-error" style={{ display: 'block', marginBottom: 12 }}>
              No active session — set one up in Settings first.
            </p>
          )}
          {activeSession && sortedArms.length === 0 && (
            <p className="field-error" style={{ display: 'block', marginBottom: 12 }}>
              No class arms configured for this session yet — add some in Settings.
            </p>
          )}

          <div className="field-row">
            <div className="field">
              <label>First name</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="e.g. Adaeze" />
            </div>
            <div className="field">
              <label>Last name</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="e.g. Okafor" />
            </div>
          </div>
          <div className="field">
            <label>Other names (optional)</label>
            <input value={otherNames} onChange={(e) => setOtherNames(e.target.value)} />
          </div>
          <div className="field">
            <label>Admission number</label>
            <input
              value={admissionNumber}
              onChange={(e) => setAdmissionNumber(e.target.value)}
              placeholder={nextAdmissionNumber || 'e.g. BPC-0142'}
            />
            {admissionNumberTaken && (
              <p className="field-error" style={{ display: 'block', marginTop: 4 }}>
                Already in use by another student.
              </p>
            )}
          </div>

          <div className="field">
            <label>Status</label>
            <div className="status-toggle">
              <div className={status === 'new' ? 'sel-new' : ''} onClick={() => setStatus('new')}>
                New student
              </div>
              <div className={status === 'existing' ? 'sel-existing' : ''} onClick={() => setStatus('existing')}>
                Existing student
              </div>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Class level</label>
              <select
                value={effectiveArm?.class_level_id ?? ''}
                onChange={(e) => {
                  const firstArmForLevel = sortedArms.find((a) => a.class_level_id === e.target.value);
                  setClassArmId(firstArmForLevel?.id ?? '');
                }}
              >
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Arm</label>
              <select value={effectiveArmId} onChange={(e) => setClassArmId(e.target.value)}>
                {sortedArms
                  .filter((a) => a.class_level_id === (effectiveArm?.class_level_id ?? sortedArms[0]?.class_level_id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Guardian phone number</label>
            <input
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
              placeholder="Start typing — we'll check for siblings already enrolled…"
            />
          </div>

          {guardianPhone.trim() &&
            (siblingMatches.length > 0 ? (
              <div className="guardian-card match">
                <div className="gtitle">✓ Existing household found</div>
                This phone number matches {siblingMatches.length} student{siblingMatches.length > 1 ? 's' : ''}{' '}
                already enrolled — likely sibling{siblingMatches.length > 1 ? 's' : ''}.
                <div className="guardian-siblings">
                  {siblingMatches.map((s) => (
                    <span className="chip" key={s.id}>
                      {s.first_name} {s.last_name}
                      {siblingLabel(s.current_class_arm_id)}
                    </span>
                  ))}
                </div>
                <div className="link-toggle">
                  <input
                    type="checkbox"
                    id="linkHousehold"
                    checked={linkAsHousehold}
                    onChange={(e) => setLinkAsHousehold(e.target.checked)}
                  />
                  <label htmlFor="linkHousehold">Link this student to the same household</label>
                </div>
              </div>
            ) : (
              <div className="guardian-card new">
                <div className="gtitle">No existing household found for this number</div>
                A new guardian record will be created and linked to this student automatically when you save.
                <div className="guardian-name-field">
                  <label>Guardian full name</label>
                  <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="e.g. Mrs. Okafor" />
                </div>
              </div>
            ))}

          <div className="field">
            <label>Address (optional)</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div className="divider-label">Additional details (optional)</div>
          <div className="field-row">
            <div className="field">
              <label>Date of birth</label>
              <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
            <div className="field">
              <label>Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Select gender</option>
                {GENDER_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Enrolling term (for charge generation)</label>
            <select value={effectiveTermId} onChange={(e) => setTermId(e.target.value)}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="divider-label">Charges generated for this term</div>
          <div className="charge-preview">
            {chargePreview.length === 0 ? (
              <div className="charge-empty">No fee items configured yet.</div>
            ) : (
              <>
                {chargePreview.map((f) => (
                  <div className="charge-row" key={f.id}>
                    <div>
                      <div className="cname">{f.name}</div>
                      <div className="ctag">{f.type === 'one-off' ? 'ONE-OFF' : 'THIS TERM'}</div>
                    </div>
                    <div className="camt">₦{f.amount.toLocaleString()}</div>
                  </div>
                ))}
                <div className="charge-total">
                  <div>Total charged now</div>
                  <div>₦{chargeTotal.toLocaleString()}</div>
                </div>
              </>
            )}
          </div>

          {error && (
            <p className="field-error" style={{ display: 'block', marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>
        <div className="panel-foot">
          <button
            className="btn-primary"
            style={{ width: '100%' }}
            onClick={handleSubmit}
            disabled={saving || admissionNumberTaken}
          >
            {saving ? 'Saving…' : 'Add student & generate charges'}
          </button>
        </div>
      </div>
    </>
  );
}
