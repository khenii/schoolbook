import { useEffect, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { logAudit } from '../../lib/auditLog';

export interface WriteOffTarget {
  chargeId: string;
  feeItemName: string;
  balance: number;
}

// The "Write off a balance" slide-over from 05-student-profile.html. Kept
// generic over any outstanding charge (not just current-term ones the
// mockup's "This term's charges" table exposes it from) — old arrears are
// exactly the kind of balance a school is most likely to need to forgive.
export default function WriteOffPanel({
  target,
  onClose,
  studentId,
  onSaved
}: {
  target: WriteOffTarget | null;
  onClose: () => void;
  studentId: string;
  onSaved: (message: string) => void;
}) {
  const db = usePowerSync();
  const { account } = useAppContext();

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setAmount(String(target.balance));
      setReason('');
      setError(null);
    }
  }, [target?.chargeId]);

  async function handleSubmit() {
    if (!target) return;
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (value > target.balance) {
      setError(`Exceeds this charge's outstanding balance (₦${target.balance.toLocaleString()}).`);
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required — this is a permanent record.');
      return;
    }
    setSaving(true);
    try {
      const writeOffId = crypto.randomUUID();
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO write_offs (id, school_id, charge_id, student_id, amount, reason, written_off_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [writeOffId, account.school_id, target.chargeId, studentId, value, reason.trim(), account.id, new Date().toISOString()]
        );
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: 'charge.written_off',
          entityType: 'charge',
          entityId: target.chargeId,
          metadata: { studentId, amount: value, reason: reason.trim() }
        });
      });
      onSaved(`₦${value.toLocaleString()} written off — reason recorded on file`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const open = !!target;

  return (
    <>
      <div className={`overlay${open ? ' show' : ''}`} onClick={onClose} />
      <div className={`panel${open ? ' show' : ''}`}>
        <div className="panel-head">
          <div>
            <h3>Write off a balance</h3>
            <p>{target ? `${target.feeItemName} · balance owed ₦${target.balance.toLocaleString()}` : ''}</p>
          </div>
          <div className="panel-close" onClick={onClose}>
            ✕
          </div>
        </div>
        <div className="panel-body">
          <div className="allocation-note" style={{ borderColor: 'var(--gold-soft)', background: '#FCF3E3' }}>
            Writing off a balance marks it as forgiven — it is <b>not</b> recorded as money received, and will not
            appear in collections totals. This action is permanent and stays visible on the student's record.
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label>Amount to write off</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label>
              Reason <span className="required-mark">*required</span>
            </label>
            <textarea
              placeholder="e.g. Family lost their home in a flood — proprietor approved full write-off, July 2026."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error && (
              <div className="field-error" style={{ display: 'block' }}>
                {error}
              </div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          <button
            className="btn-primary"
            style={{ width: '100%', background: 'var(--gold)' }}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Confirm write-off'}
          </button>
        </div>
      </div>
    </>
  );
}
