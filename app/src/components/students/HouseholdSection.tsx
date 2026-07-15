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
    return ` (${level?.name ?? ''} ${arm.name})`;
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

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>Household</h2>

      {student.household_id ? (
        <div>
          <p>
            <strong>{household?.name ?? 'Household'}</strong>
            {household?.phone ? ` · ${household.phone}` : ''}
          </p>
          {siblings.length > 0 ? (
            <ul>
              {siblings.map((s) => (
                <li key={s.id}>
                  <Link to={`/students/${s.id}`}>
                    {s.first_name} {s.last_name}
                  </Link>
                  {armLabel(s.current_class_arm_id)}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 12.5, color: '#888' }}>No other students linked to this household yet.</p>
          )}
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 12.5, color: '#888' }}>
            Not linked to a household yet. Search by name or guardian phone to link a sibling the system didn't
            catch automatically (e.g. the guardian used a different number at enrollment).
          </p>
          <input
            placeholder="Search students by name or guardian phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%' }}
          />
          {searchResults.length > 0 && (
            <ul style={{ marginTop: 8 }}>
              {searchResults.map((s) => (
                <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ flex: 1 }}>
                    {s.first_name} {s.last_name}
                    {armLabel(s.current_class_arm_id)}
                    {s.guardian_phone ? ` · ${s.guardian_phone}` : ''}
                  </span>
                  <button onClick={() => handleLink(s.id)} disabled={linking === s.id}>
                    {linking === s.id ? 'Linking…' : 'Link as household'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
