import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { generateRecurringChargesForTerm } from '../../lib/charges';

interface SessionRow {
  id: string;
  name: string;
  is_active: number;
  created_at: string;
}

interface TermRow {
  id: string;
  session_id: string;
  name: string;
}

export default function SessionsTab() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: sessions } = useQuery<SessionRow>('SELECT * FROM sessions ORDER BY name DESC');
  const { data: terms } = useQuery<TermRow>('SELECT id, session_id, name FROM terms ORDER BY created_at ASC');

  const [name, setName] = useState('');
  const [makeActive, setMakeActive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [termMessage, setTermMessage] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);

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

  async function handleGenerateCharges(term: TermRow) {
    if (
      !confirm(
        `Generate recurring charges for every enrolled student for "${term.name}"? Safe to re-run — already-charged students are skipped.`
      )
    ) {
      return;
    }
    setGenerating(term.id);
    setTermMessage((prev) => ({ ...prev, [term.id]: '' }));
    try {
      const result = await db.writeTransaction((tx) =>
        generateRecurringChargesForTerm(tx, { schoolId, termId: term.id, sessionId: term.session_id })
      );
      setTermMessage((prev) => ({
        ...prev,
        [term.id]: `${result.generated} charge${result.generated === 1 ? '' : 's'} generated, ${result.skipped} already up to date.`
      }));
    } catch (err) {
      setTermMessage((prev) => ({
        ...prev,
        [term.id]: err instanceof Error ? `Error: ${err.message}` : 'Something went wrong'
      }));
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div>
      <p style={{ color: 'var(--color-slate)', fontSize: 13 }}>
        Only one session is "active" at a time — that's the one new students and charges default to. Past sessions
        stay fully accessible and permanent even once no longer active. Add historical sessions here too when
        migrating past paper records.
      </p>

      {sessions.map((s) => {
        const sessionTerms = terms.filter((t) => t.session_id === s.id);
        const isOpen = openSessionId === s.id;
        return (
          <div key={s.id} style={{ border: '1px solid #ddd', borderRadius: 8, marginBottom: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpenSessionId(isOpen ? null : s.id)}>
                {s.name}
              </strong>
              {s.is_active ? (
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'green' }}>ACTIVE</span>
              ) : (
                <button onClick={() => setActive(s.id)}>Set as active</button>
              )}
              <button onClick={() => setOpenSessionId(isOpen ? null : s.id)}>{isOpen ? 'Hide terms' : 'Terms'}</button>
            </div>

            {isOpen && (
              <div style={{ marginTop: 12, paddingLeft: 12 }}>
                <p style={{ fontSize: 12, color: '#888' }}>
                  Generating recurring charges bills every currently-enrolled student for that term's all-students
                  recurring fee items (e.g. School Fees). One-off and new-students-only items are never generated
                  here — those only happen once, at enrollment.
                </p>
                {sessionTerms.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: '1px solid #eee'
                    }}
                  >
                    <span style={{ flex: 1 }}>{t.name}</span>
                    <button onClick={() => handleGenerateCharges(t)} disabled={generating === t.id}>
                      {generating === t.id ? 'Generating…' : 'Generate recurring charges'}
                    </button>
                    {termMessage[t.id] && (
                      <span style={{ fontSize: 12, color: '#555', marginLeft: 8 }}>{termMessage[t.id]}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

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
