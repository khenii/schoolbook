import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';

interface SessionRow {
  id: string;
  name: string;
  is_active: number;
  created_at: string;
}

export default function SessionsTab() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: sessions } = useQuery<SessionRow>('SELECT * FROM sessions ORDER BY name DESC');

  const [name, setName] = useState('');
  const [makeActive, setMakeActive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSession() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const sessionId = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.writeTransaction(async (tx) => {
        if (makeActive) {
          await tx.execute('UPDATE sessions SET is_active = 0 WHERE is_active = 1');
        }
        await tx.execute(
          'INSERT INTO sessions (id, school_id, name, is_active, created_at) VALUES (?, ?, ?, ?, ?)',
          [sessionId, schoolId, trimmed, makeActive ? 1 : 0, now]
        );
        for (const termName of ['Term 1', 'Term 2', 'Term 3']) {
          await tx.execute(
            'INSERT INTO terms (id, school_id, session_id, name, created_at) VALUES (?, ?, ?, ?, ?)',
            [crypto.randomUUID(), schoolId, sessionId, termName, now]
          );
        }
      });
      setName('');
      setAdding(false);
      setMakeActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  async function setActive(id: string) {
    await db.writeTransaction(async (tx) => {
      await tx.execute('UPDATE sessions SET is_active = 0 WHERE is_active = 1');
      await tx.execute('UPDATE sessions SET is_active = 1 WHERE id = ?', [id]);
    });
  }

  return (
    <div>
      <p style={{ color: 'var(--color-slate)', fontSize: 13 }}>
        Only one session is "active" at a time — that's the one new students and charges default to. Past sessions
        stay fully accessible and permanent even once no longer active. Add historical sessions here too when
        migrating past paper records.
      </p>

      {sessions.map((s) => (
        <div
          key={s.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: 12,
            marginBottom: 8
          }}
        >
          <strong style={{ flex: 1 }}>{s.name}</strong>
          {s.is_active ? (
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'green' }}>ACTIVE</span>
          ) : (
            <button onClick={() => setActive(s.id)}>Set as active</button>
          )}
        </div>
      ))}

      {adding ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder='Session name, e.g. "2025/2026"'
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <label style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} /> Make
            this the active session
          </label>
          <button onClick={createSession}>Add</button>
          <button
            onClick={() => {
              setAdding(false);
              setName('');
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div
          onClick={() => setAdding(true)}
          style={{ border: '1.5px dashed #ccc', borderRadius: 8, padding: 12, cursor: 'pointer', color: '#888' }}
        >
          + Add another session
        </div>
      )}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}
