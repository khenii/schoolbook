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

// The mockup's exit reason select has 4 options (Graduated / Transferred /
// Withdrawn / Other) but the schema only has two lifecycle statuses
// (withdrawn, graduated) — spec §3.11 deliberately keeps it to those two,
// since "why they left" beyond that is free text, not something the rest
// of the app needs to branch on. Transferred/Other both map to 'withdrawn'.
const REASON_OPTIONS: { value: string; label: string; status: ExitStatus }[] = [
  { value: 'graduated', label: 'Graduated', status: 'graduated' },
  { value: 'transferred', label: 'Transferred to another school', status: 'withdrawn' },
  { value: 'withdrawn', label: 'Withdrawn by parent/guardian', status: 'withdrawn' },
  { value: 'other', label: 'Other', status: 'withdrawn' }
];

// The "Withdraw student" slide-over from 05-student-profile.html.
export function ExitPanel({
  open,
  onClose,
  student,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  student: StudentSummary;
  onSaved: (message: string) => void;
}) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const { totalOutstanding, currentTermBalance, totalArrears } = useStudentLedger(student.id);

  const [reasonOption, setReasonOption] = useState('graduated');
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasBalance = totalOutstanding > 0;

  async function handleConfirm() {
    const opt = REASON_OPTIONS.find((r) => r.value === reasonOption)!;
    setSaving(true);
    try {
      await db.writeTransaction(async (tx) => {
        await tx.execute('UPDATE students SET status = ?, status_changed_at = ?, status_reason = ? WHERE id = ?', [
          opt.status,
          new Date().toISOString(),
          `${opt.label}${notes.trim() ? ` — ${notes.trim()}` : ''}`,
          student.id
        ]);
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: opt.status === 'withdrawn' ? 'student.withdrawn' : 'student.graduated',
          entityType: 'student',
          entityId: student.id,
          metadata: { reason: opt.label, notes: notes.trim() || null, outstandingBalance: totalOutstanding }
        });
      });
      setNotes('');
      setAcknowledged(false);
      onSaved(`Marked as ${opt.status} — removed from active rosters`);
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
            <h3>Withdraw student</h3>
            <p>Review outstanding balances before marking this record inactive.</p>
          </div>
          <div className="panel-close" onClick={onClose}>
            ✕
          </div>
        </div>
        <div className="panel-body">
          <div className={`exit-balance-box ${hasBalance ? 'has-balance' : 'clear'}`}>
            {hasBalance ? (
              <>
                <div style={{ fontWeight: 700, color: 'var(--rust)', fontSize: 12.5, marginBottom: 6 }}>
                  ⚠ This student still owes money
                </div>
                <div className="exit-balance-row">
                  <div>Current term balance</div>
                  <div>₦{currentTermBalance.toLocaleString()}</div>
                </div>
                <div className="exit-balance-row">
                  <div>Arrears from prior sessions</div>
                  <div>₦{totalArrears.toLocaleString()}</div>
                </div>
                <div className="exit-balance-row total">
                  <div>Total outstanding</div>
                  <div>₦{totalOutstanding.toLocaleString()}</div>
                </div>
              </>
            ) : (
              <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: 12.5 }}>
                ✓ No outstanding balance — this student is fully cleared.
              </div>
            )}
          </div>

          <div className="field">
            <label>Reason for leaving</label>
            <select value={reasonOption} onChange={(e) => setReasonOption(e.target.value)}>
              {REASON_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Notes (optional)</label>
            <textarea
              placeholder="Any additional context for the record…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="confirm-check">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              id="exitAck"
            />
            <label htmlFor="exitAck">
              I understand this does not clear or forgive any outstanding balance — it only marks the student as
              inactive. Balances remain on file and can still be collected or written off separately.
            </label>
          </div>
        </div>
        <div className="panel-foot">
          <button
            className="btn-primary"
            style={{ width: '100%', background: 'var(--rust)' }}
            onClick={handleConfirm}
            disabled={saving || !acknowledged}
          >
            {saving ? 'Saving…' : 'Confirm withdrawal'}
          </button>
        </div>
      </div>
    </>
  );
}

// The "no longer active" banner at the top of the profile, shown instead of
// the exit trigger once a student is withdrawn/graduated.
export function InactiveBanner({ student }: { student: StudentSummary }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const [reactivating, setReactivating] = useState(false);

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

  return (
    <div className="inactive-banner">
      <div className="ib-icon">🗂</div>
      <div className="ib-text">
        <b>This student is no longer active.</b> {student.status_reason ?? student.status}
        {student.status_changed_at && ` · ${new Date(student.status_changed_at).toLocaleDateString()}`}. Excluded
        from active rosters and reports, but the full record remains accessible here.
      </div>
      <a onClick={handleReactivate} style={{ opacity: reactivating ? 0.5 : 1 }}>
        {reactivating ? 'Reactivating…' : 'Reactivate'}
      </a>
    </div>
  );
}
