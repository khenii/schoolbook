import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { generateRecurringChargesForTerm } from '../../lib/charges';
import { logAudit } from '../../lib/auditLog';

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
  is_current: number;
}

// No mockup covers Sessions — it doesn't exist in the delivered designs at
// all, but sessions/terms and "generate recurring charges" are core,
// load-bearing mechanics (spec §3.9/§3.10: the whole app's current-term
// concept lives here). Styled to match the same level-card/arm-row/badge
// family used by Classes & Arms and Fee Items on this page, rather than
// left in its previous unstyled state, so the tab doesn't look bolted on.
export default function SessionsTab() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: sessions } = useQuery<SessionRow>('SELECT * FROM sessions ORDER BY name DESC');
  const { data: terms } = useQuery<TermRow>(
    'SELECT id, session_id, name, is_current FROM terms ORDER BY created_at ASC'
  );

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
        if (makeActive) {
          await tx.execute('UPDATE terms SET is_current = 0 WHERE is_current = 1');
        }
        const termNames = ['Term 1', 'Term 2', 'Term 3'];
        for (let i = 0; i < termNames.length; i++) {
          await tx.execute(
            'INSERT INTO terms (id, school_id, session_id, name, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [crypto.randomUUID(), schoolId, sessionId, termNames[i], makeActive && i === 0 ? 1 : 0, now]
          );
        }
        await logAudit(tx, {
          schoolId,
          actorId: account.id,
          action: 'session.created',
          entityType: 'session',
          entityId: sessionId,
          metadata: { name: trimmed, makeActive }
        });
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
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'session.activated',
        entityType: 'session',
        entityId: id
      });
    });
  }

  async function setCurrentTerm(termId: string) {
    await db.writeTransaction(async (tx) => {
      await tx.execute('UPDATE terms SET is_current = 0 WHERE is_current = 1');
      await tx.execute('UPDATE terms SET is_current = 1 WHERE id = ?', [termId]);
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'term.set_current',
        entityType: 'term',
        entityId: termId
      });
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
      const result = await db.writeTransaction(async (tx) => {
        const r = await generateRecurringChargesForTerm(tx, { schoolId, termId: term.id, sessionId: term.session_id });
        await logAudit(tx, {
          schoolId,
          actorId: account.id,
          action: 'charges.recurring_generated',
          entityType: 'term',
          entityId: term.id,
          metadata: { generated: r.generated, skipped: r.skipped }
        });
        return r;
      });
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
      <div className="tab-subhead">
        <div>
          <p>
            Only one session is "active" at a time — that's the one new students and charges default to. Past
            sessions stay fully accessible and permanent even once no longer active. Add historical sessions here
            too when migrating past paper records.
          </p>
        </div>
      </div>

      {sessions.map((s) => {
        const sessionTerms = terms.filter((t) => t.session_id === s.id);
        const isOpen = openSessionId === s.id;
        return (
          <div className={`level-card${isOpen ? ' open' : ''}`} key={s.id}>
            <div className="level-head" onClick={() => setOpenSessionId(isOpen ? null : s.id)}>
              <div className="level-title">
                <div className="name">{s.name}</div>
                <div className="sub">
                  {sessionTerms.length} term{sessionTerms.length !== 1 ? 's' : ''}
                </div>
              </div>
              {s.is_active ? (
                <div className="badge recurring">ACTIVE</div>
              ) : (
                <span
                  className="mini-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(s.id);
                  }}
                >
                  Set as active
                </span>
              )}
              <div className="chevron">▸</div>
            </div>

            <div className="level-body">
              <p style={{ fontSize: 12, color: 'var(--slate-soft)', marginBottom: 10, lineHeight: 1.5 }}>
                Generating recurring charges bills every currently-enrolled student for that term's all-students
                recurring fee items (e.g. School Fees). One-off and new-students-only items are never generated
                here — those only happen once, at enrollment. "Current term" drives the dashboard, reports, and each
                student's balance split — only one term across the whole school can be current at a time.
              </p>
              {sessionTerms.map((t) => (
                <div className="arm-row" key={t.id} style={{ flexWrap: 'wrap' }}>
                  <div className="arm-name">
                    {t.name}
                    {t.is_current ? (
                      <span className="badge recurring" style={{ marginLeft: 8 }}>
                        CURRENT
                      </span>
                    ) : null}
                  </div>
                  {!t.is_current && (
                    <span className="mini-btn" onClick={() => setCurrentTerm(t.id)}>
                      Set as current
                    </span>
                  )}
                  <button className="btn-ghost" onClick={() => handleGenerateCharges(t)} disabled={generating === t.id}>
                    {generating === t.id ? 'Generating…' : 'Generate recurring charges'}
                  </button>
                  {termMessage[t.id] && (
                    <div style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--slate-soft)', marginTop: 4 }}>
                      {termMessage[t.id]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="add-arm-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder='Session name, e.g. "2025/2026"'
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} />
            Make this the active session
          </label>
          <button onClick={createSession}>Add</button>
          <button
            onClick={() => {
              setAdding(false);
              setName('');
            }}
            style={{ color: 'var(--slate-soft)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="add-level-card" onClick={() => setAdding(true)}>
          + Add another session
        </div>
      )}
      {error && (
        <p className="field-error" style={{ display: 'block' }}>
          {error}
        </p>
      )}
    </div>
  );
}
