import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { usePowerSync } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useSchoolLedger } from '../hooks/useSchoolLedger';
import { logAudit } from '../lib/auditLog';

type Action = 'promote' | 'repeat' | 'graduate' | 'withdraw';

// "Promote a class to the next session" from 11-promotion.html. The mockup
// assumes a fixed current→next session and a "Promote" action that silently
// means "graduate" once there's no next level; the real schema has no such
// guarantee (sessions aren't necessarily sequential, arms aren't guaranteed
// to exist yet in the target session), so this keeps the explicit From/To
// session pickers and a distinct fourth "Graduate" action rather than
// overloading Promote — both already existed before this restyle and are
// disclosed here rather than removed to match the mockup literally.
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
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const sessionsSorted = useMemo(() => [...sessions].sort((a, b) => b.created_at.localeCompare(a.created_at)), [sessions]);

  const armsForSourceLevel = useMemo(
    () => arms.filter((a) => a.session_id === sourceSessionId && a.class_level_id === sourceLevelId),
    [arms, sourceSessionId, sourceLevelId]
  );

  const levelsWithArmsInSession = useMemo(() => {
    const levelIds = new Set(arms.filter((a) => a.session_id === sourceSessionId).map((a) => a.class_level_id));
    return levels.filter((l) => levelIds.has(l.id));
  }, [arms, levels, sourceSessionId]);

  const sourceSessionName = sessions.find((s) => s.id === sourceSessionId)?.name;
  const targetSessionName = sessions.find((s) => s.id === targetSessionId)?.name;
  const sourceLevel = levels.find((l) => l.id === sourceLevelId);
  const sourceArm = arms.find((a) => a.id === sourceArmId);
  const nextLevel = sourceLevel ? levels.find((l) => l.sort_order === sourceLevel.sort_order + 1) : undefined;

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
    () =>
      enrolledStudents
        .filter((s) => s.current_class_arm_id === sourceArmId)
        .sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name)),
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

  function setAll(action: Action) {
    const next: Record<string, Action> = {};
    for (const s of roster) next[s.id] = action;
    setActions(next);
    setResult(null);
  }

  function blockedReason(action: Action): string | null {
    if (action === 'promote') {
      if (!nextLevel) return 'No next class level configured (this is the top level) — choose Graduate instead.';
      if (!targetPromoteArm) return `No "${sourceArm?.name}" arm in ${nextLevel.name} for the target session yet.`;
    }
    if (action === 'repeat') {
      if (!targetRepeatArm) return `No "${sourceArm?.name}" arm in ${sourceLevel?.name} for the target session yet.`;
    }
    return null;
  }

  const readyToPick = sourceSessionId && sourceLevelId && sourceArmId && targetSessionId && sourceSessionId !== targetSessionId;
  const hasBlockedRows = roster.some((s) => blockedReason(actionFor(s.id)) !== null);

  const promoteCount = roster.filter((s) => actionFor(s.id) === 'promote').length;
  const repeatCount = roster.filter((s) => actionFor(s.id) === 'repeat').length;
  const graduateCount = roster.filter((s) => actionFor(s.id) === 'graduate').length;
  const withdrawCount = roster.filter((s) => actionFor(s.id) === 'withdraw').length;

  async function handleConfirm() {
    setError(null);
    if (roster.length === 0) return;

    const summary = [
      promoteCount && `${promoteCount} promoted to ${nextLevel?.name ?? ''} ${sourceArm?.name ?? ''}`,
      repeatCount && `${repeatCount} repeating ${sourceLevel?.name ?? ''} ${sourceArm?.name ?? ''}`,
      graduateCount && `${graduateCount} graduated`,
      withdrawCount && `${withdrawCount} withdrawn`
    ]
      .filter(Boolean)
      .join(', ');

    if (
      !window.confirm(
        `Apply this to all ${roster.length} students in ${sourceLevel?.name} ${sourceArm?.name}?\n\n${summary}\n\nThis cannot be undone in bulk — it can only be corrected student by student afterward.`
      )
    ) {
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
      setResult(`${promoteCount} promoted to ${nextLevel ? `${nextLevel.name} ${sourceArm?.name}` : 'graduated'}, ${repeatCount} repeating ${sourceLevel?.name} ${sourceArm?.name}, ${graduateCount} graduated, ${withdrawCount} marked withdrawn. A new enrollment record was added for each student — prior charges and payments are untouched.`);
      setActions({});
      setToast('Promotion applied');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <AppShell title="Promotion" pageClass="page-promotion">
      <div className="page-head">
        <div className="eyebrow">End of session</div>
        <h2>Promote a class to the next session</h2>
        <p>
          Everyone defaults to promoting. Override individual students who are repeating the class, graduating, or
          leaving — history stays intact either way, and nothing here touches existing charges or payments.
        </p>
      </div>

      {result && (
        <div className="done-banner show">
          <div className="dt">✓ Promotion applied for {sourceLevel?.name} {sourceArm?.name}</div>
          <div className="ds">{result}</div>
        </div>
      )}

      <div className="selector-bar">
        <div className="selector-group">
          <label>From session</label>
          <select
            value={sourceSessionId}
            onChange={(e) => {
              setSourceSessionId(e.target.value);
              setSourceLevelId('');
              setSourceArmId('');
              setActions({});
              setResult(null);
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
        <div className="selector-group">
          <label>Class level</label>
          <select
            value={sourceLevelId}
            onChange={(e) => {
              setSourceLevelId(e.target.value);
              setSourceArmId('');
              setActions({});
              setResult(null);
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
        <div className="selector-group">
          <label>Arm</label>
          <select
            value={sourceArmId}
            onChange={(e) => {
              setSourceArmId(e.target.value);
              setActions({});
              setResult(null);
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
        <div className="selector-group">
          <label>To session</label>
          <select
            value={targetSessionId}
            onChange={(e) => {
              setTargetSessionId(e.target.value);
              setActions({});
              setResult(null);
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
        {readyToPick && (
          <div className="promo-arrow">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="from">
                {sourceLevel?.name} {sourceArm?.name} · {sourceSessionName}
              </span>
              <span className="arrow">→</span>
              <span className="to">
                {nextLevel ? `${nextLevel.name} ${sourceArm?.name}` : 'Graduating'} · {targetSessionName}
              </span>
            </div>
          </div>
        )}
      </div>

      {!readyToPick ? (
        <p className="empty-note">Pick a source class arm and a target session to see the roster.</p>
      ) : (
        <>
          <div className="bulk-bar">
            <div className="left">
              {roster.length} student{roster.length === 1 ? '' : 's'} in {sourceLevel?.name} {sourceArm?.name}
            </div>
            <div className="bulk-actions">
              <button className="bulk-btn" onClick={() => setAll('promote')}>
                Set all: {nextLevel ? 'Promote' : 'Graduate'}
              </button>
              <button className="bulk-btn" onClick={() => setAll('repeat')}>
                Set all: Repeat
              </button>
              <button className="bulk-btn" onClick={() => setAll('withdraw')}>
                Set all: Withdraw
              </button>
            </div>
          </div>

          {roster.length === 0 ? (
            <div className="empty-note">No enrolled students in this class arm.</div>
          ) : (
            <div className="roster-wrap">
              <div className="p-row head">
                <div className="col-student">Student</div>
                <div className="col-current">Current class</div>
                <div className="col-action">Action for {targetSessionName}</div>
                <div className="col-result">Result</div>
              </div>
              {roster.map((s) => {
                const action = actionFor(s.id);
                const blocked = blockedReason(action);
                const rowClass = action === 'repeat' ? ' action-repeat' : action === 'withdraw' ? ' action-withdraw' : '';
                let resultText: string;
                let resultClass: string;
                if (action === 'promote') {
                  resultText = nextLevel ? `→ ${nextLevel.name} ${sourceArm?.name}` : '→ Graduated';
                  resultClass = 'result-promote';
                } else if (action === 'repeat') {
                  resultText = `→ ${sourceLevel?.name} ${sourceArm?.name} (repeat)`;
                  resultClass = 'result-repeat';
                } else if (action === 'graduate') {
                  resultText = '→ Graduated';
                  resultClass = 'result-promote';
                } else {
                  resultText = '→ Withdrawn';
                  resultClass = 'result-withdraw';
                }
                return (
                  <div key={s.id}>
                    <div className={`p-row${rowClass}`}>
                      <div className="col-student">
                        <div className="n">
                          {s.last_name} {s.first_name}
                        </div>
                        <div className="c">{classLabel(s.current_class_arm_id)}</div>
                      </div>
                      <div className="col-current">
                        {sourceLevel?.name} {sourceArm?.name}
                      </div>
                      <div className="col-action">
                        <select className="action-select" value={action} onChange={(e) => setAction(s.id, e.target.value as Action)}>
                          <option value="promote">
                            {nextLevel ? `Promote to ${nextLevel.name} ${sourceArm?.name ?? ''}` : 'Promote (no next level)'}
                          </option>
                          <option value="repeat">Repeat {sourceLevel?.name}</option>
                          <option value="graduate">Graduate</option>
                          <option value="withdraw">Withdraw / not returning</option>
                        </select>
                      </div>
                      <div className={`col-result ${resultClass}`}>{resultText}</div>
                    </div>
                    {blocked && (
                      <div className="field-error" style={{ display: 'block', padding: '0 16px 10px' }}>
                        {blocked}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {roster.length > 0 && (
            <>
              <div className="summary-bar">
                <div className="sstat success">
                  <div className="label">Promoting</div>
                  <div className="value">{promoteCount}</div>
                </div>
                <div className="sstat gold">
                  <div className="label">Repeating</div>
                  <div className="value">{repeatCount}</div>
                </div>
                <div className="sstat success">
                  <div className="label">Graduating</div>
                  <div className="value">{graduateCount}</div>
                </div>
                <div className="sstat rust">
                  <div className="label">Withdrawing</div>
                  <div className="value">{withdrawCount}</div>
                </div>
              </div>

              <div className="confirm-bar" style={{ alignItems: 'center', gap: 12 }}>
                {hasBlockedRows && (
                  <span style={{ color: 'var(--rust)', fontSize: 12 }}>
                    Resolve the blocked rows above (or change their action) before confirming.
                  </span>
                )}
                {error && <span style={{ color: 'var(--rust)', fontSize: 12 }}>{error}</span>}
                <button className="btn-primary" onClick={handleConfirm} disabled={confirming || hasBlockedRows}>
                  {confirming ? 'Applying…' : 'Confirm and apply'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </AppShell>
  );
}
