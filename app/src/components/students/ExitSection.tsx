import { useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { useStudentLedger } from '../../hooks/useStudentLedger';
import { logAudit } from '../../lib/auditLog';

interface StudentSummary {
  id: string;
  status: string;
  status_changed_at: string | null;
  status_reason: string | null;
}

type ExitStatus = 'withdrawn' | 'graduated';

export default function ExitSection({ student }: { student: StudentSummary }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const { totalOutstanding, totalArrears, currentTermBalance, payments } = useStudentLedger(student.id);

  const [open, setOpen] = useState(false);
  const [exitStatus, setExitStatus] = useState<ExitStatus>('withdrawn');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const isActive = student.status === 'new' || student.status === 'existing';
  const hasBalance = totalOutstanding > 0;

  async function handleConfirm() {
    setSaving(true);
    try {
      await db.writeTransaction(async (tx) => {
        await tx.execute('UPDATE students SET status = ?, status_changed_at = ?, status_reason = ? WHERE id = ?', [
          exitStatus,
          new Date().toISOString(),
          reason.trim() || null,
          student.id
        ]);
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: exitStatus === 'withdrawn' ? 'student.withdrawn' : 'student.graduated',
          entityType: 'student',
          entityId: student.id,
          metadata: { reason: reason.trim() || null, outstandingBalance: totalOutstanding }
        });
      });
      setOpen(false);
      setReason('');
      setAcknowledged(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleReactivate() {
    setReactivating(true);
    try {
      await db.writeTransaction(async (tx) => {
        await tx.execute('UPDATE students SET status = ?, status_changed_at = ?, status_reason = ? WHERE id = ?', [
          'existing',
          new Date().toISOString(),
          'Reactivated',
          student.id
        ]);
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: 'student.reactivated',
          entityType: 'student',
          entityId: student.id
        });
      });
    } finally {
      setReactivating(false);
    }
  }

  if (!isActive) {
    return (
      <div style={{ margin: '1.5rem 0', padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong style={{ textTransform: 'capitalize' }}>{student.status}</strong>
          {student.status_changed_at && ` on ${new Date(student.status_changed_at).toLocaleDateString()}`}
          {student.status_reason && ` — ${student.status_reason}`}
        </p>
        <p style={{ fontSize: 12, color: '#888', margin: '4px 0 8px' }}>
          Excluded from active rosters, the Class Register, and defaulter/collection reports by default. Their
          balance, payment history, and notes remain fully visible here.
        </p>
        <button onClick={handleReactivate} disabled={reactivating} style={{ fontSize: 12 }}>
          {reactivating ? 'Reactivating…' : 'Reactivate (mark as existing)'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ margin: '1.5rem 0' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ fontSize: 12.5 }}>
          Withdraw / graduate this student
        </button>
      ) : (
        <div style={{ padding: 14, border: '1px solid #ddd', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Exit checklist</h3>
          <p style={{ fontSize: 12.5, color: '#555' }}>
            Before marking this student inactive, here's where their account stands. Marking them withdrawn or
            graduated does <strong>not</strong> clear or write off any balance — it stays on their record exactly as
            it is. {payments.length} payment{payments.length === 1 ? '' : 's'} on file.
          </p>

          <div style={{ display: 'flex', gap: 24, margin: '10px 0' }}>
            <div>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Current term balance</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: currentTermBalance > 0 ? 'crimson' : 'inherit' }}>
                ₦{currentTermBalance.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Arrears</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: totalArrears > 0 ? 'crimson' : 'inherit' }}>
                ₦{totalArrears.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Total outstanding</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: totalOutstanding > 0 ? 'crimson' : 'inherit' }}>
                ₦{totalOutstanding.toLocaleString()}
              </div>
            </div>
          </div>

          {hasBalance && (
            <p style={{ fontSize: 12.5, color: 'crimson', background: '#FBEBE9', padding: 8, borderRadius: 6 }}>
              This student has an outstanding balance of ₦{totalOutstanding.toLocaleString()}. It will remain on
              their record after this — to forgive it instead, use a write-off from the charges table above.
            </p>
          )}

          <div style={{ display: 'flex', gap: 16, margin: '10px 0' }}>
            <label style={{ fontSize: 13 }}>
              <input
                type="radio"
                checked={exitStatus === 'withdrawn'}
                onChange={() => setExitStatus('withdrawn')}
              />{' '}
              Withdrawn
            </label>
            <label style={{ fontSize: 13 }}>
              <input
                type="radio"
                checked={exitStatus === 'graduated'}
                onChange={() => setExitStatus('graduated')}
              />{' '}
              Graduated
            </label>
          </div>

          <input
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />

          {hasBalance && (
            <label style={{ fontSize: 12.5, display: 'block', marginBottom: 8 }}>
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I
              understand this balance stays on the record and isn't cleared by this action.
            </label>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleConfirm} disabled={saving || (hasBalance && !acknowledged)}>
              {saving ? 'Saving…' : `Confirm ${exitStatus === 'withdrawn' ? 'withdrawal' : 'graduation'}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAcknowledged(false);
                setReason('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
