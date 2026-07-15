import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePowerSync } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useSchoolLedger } from '../hooks/useSchoolLedger';
import { logAudit } from '../lib/auditLog';

type Action = 'promote' | 'repeat' | 'graduate' | 'withdraw';

export default function PromotionPage() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const { levels, arms, sessions, enrolledStudents, classLabel } = useSchoolLedger();

  const [sourceSessionId, setSourceSessionId] = useState('');
  const [sourceLevelId, setSourceLevelId] = useState('');
  const [sourceArmId, setSourceArmId] = useState('');
  const [targetSessionId, setTargetSessionId] = useState('');
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const sessionsSorted = useMemo(() => [...sessions].sort((a, b) => b.created_at.localeCompare(a.created_at)), [sessions]);

  const armsForSourceLevel = useMemo(
    () => arms.filter((a) => a.session_id === sourceSessionId && a.class_level_id === sourceLevelId),
    [arms, sourceSessionId, sourceLevelId]
  );

  const levelsWithArmsInSession = useMemo(() => {
    const levelIds = new Set(arms.filter((a) => a.session_id === sourceSessionId).map((a) => a.class_level_id));
    return levels.filter((l) => levelIds.has(l.id));
  }, [arms, levels, sourceSessionId]);

  const sourceLevel = levels.find((l) => l.id === sourceLevelId);
  const sourceArm = arms.find((a) => a.id === sourceArmId);
  const nextLevel = sourceLevel
    ? levels.find((l) => l.sort_order === sourceLevel.sort_order + 1)
    : undefined;

  const targetPromoteArm = useMemo(
    () =>
      nextLevel
        ? arms.find((a) => a.session_id === targetSessionId && a.class_level_id === nextLevel.id && a.name === sourceArm?.name)
        : undefined,
    [arms, targetSessionId, nextLevel, sourceArm]
  );
  const targetRepeatArm = useMemo(
    () =>
      sourceLevel
        ? arms.find((a) => a.session_id === targetSessionId && a.class_level_id === sourceLevel.id && a.name === sourceArm?.name)
        : undefined,
    [arms, targetSessionId, sourceLevel, sourceArm]
  );

  const roster = useMemo(
    () => enrolledStudents.filter((s) => s.current_class_arm_id === sourceArmId).sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name)),
    [enrolledStudents, sourceArmId]
  );

  const defaultAction: Action = nextLevel ? 'promote' : 'graduate';

  function actionFor(studentId: string): Action {
    return actions[studentId] ?? defaultAction;
  }

  function setAction(studentId: string, action: Action) {
    setActions((prev) => ({ ...prev, [studentId]: action }));
    setResult(null);
  }

  // A row is "blocked" if its action needs a resolved target arm that
  // doesn't exist yet — surfaced rather than guessed at, since silently
  // picking a different arm (or skipping the student) would be exactly the
  // kind of surprise state change this app avoids everywhere else.
  function blockedReason(action: Action): string | null {
    if (action === 'promote') {
      if (!nextLevel) return "No next class level configured (this is the top level) — choose Graduate instead.";
      if (!targetPromoteArm) return `No "${sourceArm?.name}" arm in ${nextLevel.name} for the target session yet.`;
    }
    if (action === 'repeat') {
      if (!targetRepeatArm) return `No "${sourceArm?.name}" arm in ${sourceLevel?.name} for the target session yet.`;
    }
    return null;
  }

  const readyToPick = sourceSessionId && sourceLevelId && sourceArmId && targetSessionId && sourceSessionId !== targetSessionId;
  const hasBlockedRows = roster.some((s) => blockedReason(actionFor(s.id)) !== null);

  async function handleConfirm() {
    setError(null);
    if (roster.length === 0) return;

    const promoteCount = roster.filter((s) => actionFor(s.id) === 'promote').length;
    const repeatCount = roster.filter((s) => actionFor(s.id) === 'repeat').length;
    const graduateCount = roster.filter((s) => actionFor(s.id) === 'graduate').length;
    const withdrawCount = roster.filter((s) => actionFor(s.id) === 'withdraw').length;

    const summary = [
      promoteCount && `${promoteCount} promoted to ${nextLevel?.name ?? ''} ${sourceArm?.name ?? ''}`,
      repeatCount && `${repeatCount} repeating ${sourceLevel?.name ?? ''} ${sourceArm?.name ?? ''}`,
      graduateCount && `${graduateCount} graduated`,
      withdrawCount && `${withdrawCount} withdrawn`
    ]
      .filter(Boolean)
      .join(', ');

    if (!window.confirm(`Apply this to all ${roster.length} students in ${sourceLevel?.name} ${sourceArm?.name}?\n\n${summary}\n\nThis cannot be undone in bulk — it can only be corrected student by student afterward.`)) {
      return;
    }

    setConfirming(true);
    try {
      const now = new Date().toISOString();
      await db.writeTransaction(async (tx) => {
        for (const s of roster) {
          const action = actionFor(s.id);
          if (action === 'promote' && nextLevel && targetPromoteArm) {
            await tx.execute('UPDATE students SET current_class_arm_id = ? WHERE id = ?', [targetPromoteArm.id, s.id]);
            await tx.execute(
              `INSERT INTO enrollment_history (id, school_id, student_id, session_id, class_level_id, class_arm_id, type, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'promoted', ?)`,
              [crypto.randomUUID(), account.school_id, s.id, targetSessionId, nextLevel.id, targetPromoteArm.id, now]
            );
          } else if (action === 'repeat' && sourceLevel && targetRepeatArm) {
            await tx.execute('UPDATE students SET current_class_arm_id = ? WHERE id = ?', [targetRepeatArm.id, s.id]);
            await tx.execute(
              `INSERT INTO enrollment_history (id, school_id, student_id, session_id, class_level_id, class_arm_id, type, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'repeated', ?)`,
              [crypto.randomUUID(), account.school_id, s.id, targetSessionId, sourceLevel.id, targetRepeatArm.id, now]
            );
          } else if (action === 'graduate') {
            await tx.execute('UPDATE students SET status = ?, status_changed_at = ?, status_reason = ? WHERE id = ?', [
              'graduated',
              now,
              'Graduated via promotion flow',
              s.id
            ]);
          } else if (action === 'withdraw') {
            await tx.execute('UPDATE students SET status = ?, status_changed_at = ?, status_reason = ? WHERE id = ?', [
              'withdrawn',
              now,
              'Not carried forward — promotion flow',
              s.id
            ]);
          }
        }
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: 'promotion.run',
          entityType: 'class_arm',
          entityId: sourceArmId,
          metadata: {
            fromLevel: sourceLevel?.name,
            fromArm: sourceArm?.name,
            toSessionId: targetSessionId,
            promoteCount,
            repeatCount,
            graduateCount,
            withdrawCount,
            studentIds: roster.map((s) => s.id)
          }
        });
      });
      setResult(`Done — ${summary}.`);
      setActions({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
      <h1 style={{ marginBottom: 2 }}>Promotion</h1>
      <p style={{ color: '#64748b', margin: 0 }}>
        A deliberate, end-of-session action — nothing here happens automatically. Pick a source class arm and where
        its students are heading, review the default per student, then confirm as one batch. Historical charges and
        payments are never touched by this.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          margin: '1.25rem 0',
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '14px 16px'
        }}
      >
        <div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>From session</div>
          <select
            value={sourceSessionId}
            onChange={(e) => {
              setSourceSessionId(e.target.value);
              setSourceLevelId('');
              setSourceArmId('');
              setActions({});
            }}
          >
            <option value="" disabled>
              Select session
            </option>
            {sessionsSorted.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Class level</div>
          <select
            value={sourceLevelId}
            onChange={(e) => {
              setSourceLevelId(e.target.value);
              setSourceArmId('');
              setActions({});
            }}
            disabled={!sourceSessionId}
          >
            <option value="" disabled>
              Select level
            </option>
            {levelsWithArmsInSession.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Arm</div>
          <select
            value={sourceArmId}
            onChange={(e) => {
              setSourceArmId(e.target.value);
              setActions({});
            }}
            disabled={!sourceLevelId}
          >
            <option value="" disabled>
              Select arm
            </option>
            {armsForSourceLevel.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 1, height: 36, background: '#e2e8f0' }} />
        <div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>To session</div>
          <select
            value={targetSessionId}
            onChange={(e) => {
              setTargetSessionId(e.target.value);
              setActions({});
            }}
          >
            <option value="" disabled>
              Select session
            </option>
            {sessionsSorted
              .filter((s) => s.id !== sourceSessionId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {!readyToPick ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Pick a source class arm and a target session to see the roster.</p>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: '#64748b' }}>
            {roster.length} student{roster.length === 1 ? '' : 's'} in {sourceLevel?.name} {sourceArm?.name}
            {nextLevel && targetPromoteArm && (
              <> — default action promotes to {nextLevel.name} {targetPromoteArm.name}.</>
            )}
          </p>

          {roster.length === 0 ? (
            <p style={{ color: '#888' }}>No enrolled students in this class arm.</p>
          ) : (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex',
                  padding: '9px 16px',
                  background: '#f8fafc',
                  fontSize: 10.5,
                  textTransform: 'uppercase',
                  color: '#64748b',
                  fontWeight: 600
                }}
              >
                <div style={{ flex: 1.6 }}>Student</div>
                <div style={{ flex: 1.4 }}>Action</div>
              </div>
              {roster.map((s) => {
                const action = actionFor(s.id);
                const blocked = blockedReason(action);
                return (
                  <div
                    key={s.id}
                    style={{
                      padding: '10px 16px',
                      borderBottom: '1px solid #eee',
                      fontSize: 13
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1.6 }}>
                        {s.last_name} {s.first_name}
                        <span style={{ color: '#94a3b8', fontSize: 11 }}> · {classLabel(s.current_class_arm_id)}</span>
                      </div>
                      <div style={{ flex: 1.4 }}>
                        <select value={action} onChange={(e) => setAction(s.id, e.target.value as Action)}>
                          <option value="promote">
                            {nextLevel ? `Promote to ${nextLevel.name} ${sourceArm?.name ?? ''}` : 'Promote (no next level)'}
                          </option>
                          <option value="repeat">Repeat {sourceLevel?.name}</option>
                          <option value="graduate">Graduate</option>
                          <option value="withdraw">Withdraw / do not carry forward</option>
                        </select>
                      </div>
                    </div>
                    {blocked && <p style={{ color: 'crimson', fontSize: 11.5, margin: '4px 0 0' }}>{blocked}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {roster.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button onClick={handleConfirm} disabled={confirming || hasBlockedRows}>
                {confirming ? 'Applying…' : `Confirm for all ${roster.length} students`}
              </button>
              {hasBlockedRows && (
                <span style={{ color: 'crimson', fontSize: 12, marginLeft: 10 }}>
                  Resolve the blocked rows above (or change their action) before confirming.
                </span>
              )}
              {error && <p style={{ color: 'crimson' }}>{error}</p>}
              {result && <p style={{ color: 'green' }}>{result}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
