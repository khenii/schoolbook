import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { linkStudentsToHousehold } from '../../lib/households';

interface StudentSummary {
  id: string;
  first_name: string;
  last_name: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  household_id: string | null;
  current_class_arm_id: string | null;
}

interface HouseholdRow {
  id: string;
  name: string;
  phone: string | null;
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

// The "household-card" from 05-student-profile.html. The mockup only shows
// the linked state (siblings already found); the "not linked yet" state
// below is a real, necessary case the mockup doesn't cover, styled to match
// the same family of components rather than left as a bare list.
export default function HouseholdSection({ student }: { student: StudentSummary }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: households } = useQuery<HouseholdRow>('SELECT id, name, phone FROM households WHERE id = ?', [
    student.household_id ?? ''
  ]);
  const household = households[0];

  const { data: allStudents } = useQuery<StudentSummary>(
    'SELECT id, first_name, last_name, guardian_name, guardian_phone, household_id, current_class_arm_id FROM students'
  );
  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name FROM class_levels');

  const armLabel = (armId: string | null) => {
    if (!armId) return '';
    const arm = arms.find((a) => a.id === armId);
    if (!arm) return '';
    const level = levels.find((l) => l.id === arm.class_level_id);
    return `${level?.name ?? ''} ${arm.name}`.trim();
  };

  const siblings = allStudents.filter((s) => s.household_id === student.household_id && s.id !== student.id);

  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState<string | null>(null);

  const searchResults =
    search.trim().length > 0
      ? allStudents
          .filter((s) => s.id !== student.id && s.household_id !== student.household_id)
          .filter((s) => {
            const q = search.trim().toLowerCase();
            return (
              s.first_name.toLowerCase().includes(q) ||
              s.last_name.toLowerCase().includes(q) ||
              (s.guardian_phone ?? '').toLowerCase().includes(q) ||
              (s.guardian_name ?? '').toLowerCase().includes(q)
            );
          })
      : [];

  async function handleLink(otherId: string) {
    setLinking(otherId);
    try {
      await db.writeTransaction((tx) =>
        linkStudentsToHousehold(tx, {
          schoolId,
          studentIds: [student.id, otherId],
          fallbackName: student.guardian_name ?? undefined,
          fallbackPhone: student.guardian_phone ?? undefined
        })
      );
      setSearch('');
    } finally {
      setLinking(null);
    }
  }

  if (student.household_id) {
    return (
      <div className="household-card">
        <div className="household-icon">👪</div>
        <div className="household-body">
          <div className="household-title">
            {household?.name ?? 'Household'}
            {siblings.length > 0 ? ` — ${siblings.length} sibling${siblings.length === 1 ? '' : 's'} also enrolled` : ''}
          </div>
          {siblings.length > 0 ? (
            <div className="household-siblings">
              {siblings.map((s) => (
                <Link key={s.id} to={`/students/${s.id}`} style={{ textDecoration: 'none' }}>
                  <span className="sibling-chip">
                    {s.first_name} {s.last_name}
                    {armLabel(s.current_class_arm_id) && ` · ${armLabel(s.current_class_arm_id)}`}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--slate-soft)' }}>No other students linked yet.</div>
          )}
        </div>
        <Link
          className="btn-ghost"
          to={`/payments?household=${student.household_id}`}
          style={{ textDecoration: 'none', display: 'inline-block' }}
        >
          Pay for whole family →
        </Link>
      </div>
    );
  }

  return (
    <div className="household-card" style={{ background: 'var(--paper)', alignItems: 'flex-start' }}>
      <div className="household-icon">👪</div>
      <div className="household-body">
        <div className="household-title">Not linked to a household yet</div>
        <div style={{ fontSize: 11.5, color: 'var(--slate-soft)', marginBottom: 8 }}>
          Search by name or guardian phone to link a sibling the system didn't catch automatically.
        </div>
        <input
          type="text"
          placeholder="Search students by name or guardian phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: 340 }}
        />
        {searchResults.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchResults.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>
                  {s.first_name} {s.last_name}
                  {armLabel(s.current_class_arm_id) && ` · ${armLabel(s.current_class_arm_id)}`}
                  {s.guardian_phone ? ` · ${s.guardian_phone}` : ''}
                </span>
                <span className="mini-btn" onClick={() => handleLink(s.id)}>
                  {linking === s.id ? 'Linking…' : 'Link as household'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
