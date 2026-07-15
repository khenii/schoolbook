import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@powersync/react';
import { exportToCSV } from '../lib/csv';

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  status: string;
  current_class_arm_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
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

export default function StudentsPage() {
  const location = useLocation();
  const navState = location.state as { justAdded?: string; chargeCount?: number } | null;

  const [search, setSearch] = useState('');
  const { data: students } = useQuery<StudentRow>('SELECT * FROM students ORDER BY last_name ASC, first_name ASC');
  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name FROM class_levels');

  const armLabel = (armId: string | null) => {
    if (!armId) return '—';
    const arm = arms.find((a) => a.id === armId);
    if (!arm) return '—';
    const level = levels.find((l) => l.id === arm.class_level_id);
    return `${level?.name ?? ''} ${arm.name}`.trim();
  };

  const filtered = students.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.first_name.toLowerCase().includes(q) ||
      s.last_name.toLowerCase().includes(q) ||
      s.admission_number.toLowerCase().includes(q)
    );
  });

  function handleExport() {
    exportToCSV(
      `students-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Admission #', 'Class', 'Status', 'Guardian Name', 'Guardian Phone'],
      filtered.map((s) => [
        `${s.last_name} ${s.first_name}`,
        s.admission_number,
        armLabel(s.current_class_arm_id),
        s.status,
        s.guardian_name ?? '',
        s.guardian_phone ?? ''
      ])
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Students</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport} disabled={filtered.length === 0}>
            Export CSV
          </button>
          <Link to="/students/new">
            <button>+ Add student</button>
          </Link>
        </div>
      </div>

      {navState?.justAdded && (
        <p style={{ color: 'green' }}>
          Added {navState.justAdded} — {navState.chargeCount ?? 0} charge{navState.chargeCount === 1 ? '' : 's'}{' '}
          generated.
        </p>
      )}

      <input
        placeholder="Search by name or admission number"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', margin: '1rem 0' }}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Admission #</th>
            <th style={{ padding: 8 }}>Class</th>
            <th style={{ padding: 8 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>
                <Link to={`/students/${s.id}`}>
                  {s.last_name} {s.first_name}
                </Link>
              </td>
              <td style={{ padding: 8 }}>{s.admission_number}</td>
              <td style={{ padding: 8 }}>{armLabel(s.current_class_arm_id)}</td>
              <td style={{ padding: 8 }}>{s.status}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 8, color: '#888' }}>
                No students yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
