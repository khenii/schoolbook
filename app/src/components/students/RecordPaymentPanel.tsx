import { useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { useStudentLedger } from '../../hooks/useStudentLedger';
import { logAudit } from '../../lib/auditLog';

type Method = 'cash' | 'bank-transfer' | 'pos' | 'other';

// The "Record a payment" slide-over from 05-student-profile.html. Same
// oldest-debt-first allocation rule as before (spec §3.2/§3.3), plus the
// ability to target one specific charge instead — a real capability the
// mockup's simplified two-option "Apply to" select doesn't show, kept here
// because restricting it would be a functional regression.
export default function RecordPaymentPanel({
  open,
  onClose,
  studentId,
  studentName,
  classLabel,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  classLabel: string;
  onSaved: (message: string) => void;
}) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { outstandingOldestFirst, totalOutstanding } = useStudentLedger(studentId);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptNumber, setReceiptNumber] = useState('');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [manualChargeId, setManualChargeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAmount('');
    setMethod('cash');
    setDate(new Date().toISOString().slice(0, 10));
    setReceiptNumber('');
    setMode('auto');
    setManualChargeId('');
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    const total = Number(amount);
    if (!total || total <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    if (mode === 'manual') {
      const charge = outstandingOldestFirst.find((c) => c.id === manualChargeId);
      if (!charge) {
        setError('Choose which charge this payment applies to.');
        return;
      }
      if (total > charge.balance) {
        setError(`Amount exceeds this charge's outstanding balance (₦${charge.balance.toLocaleString()}).`);
        return;
      }
    } else if (total > totalOutstanding) {
      setError(`Amount exceeds total outstanding balance (₦${totalOutstanding.toLocaleString()}).`);
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const transactionId = crypto.randomUUID();

      const allocations: { chargeId: string; amount: number }[] = [];
      if (mode === 'manual') {
        allocations.push({ chargeId: manualChargeId, amount: total });
      } else {
        let remaining = total;
        for (const charge of outstandingOldestFirst) {
          if (remaining <= 0) break;
          const allocated = Math.min(charge.balance, remaining);
          allocations.push({ chargeId: charge.id, amount: allocated });
          remaining -= allocated;
        }
      }

      await db.writeTransaction(async (tx) => {
        for (const a of allocations) {
          await tx.execute(
            `INSERT INTO payments
               (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
                household_transaction_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              schoolId,
              studentId,
              a.chargeId,
              a.amount,
              date,
              method,
              receiptNumber.trim() || null,
              account.id,
              transactionId,
              now
            ]
          );
        }
        await logAudit(tx, {
          schoolId,
          actorId: account.id,
          action: 'payment.recorded',
          entityType: 'payment',
          entityId: transactionId,
          metadata: { studentId, total, method, chargeCount: allocations.length }
        });
      });

      const msg = `₦${total.toLocaleString()} recorded across ${allocations.length} charge${allocations.length === 1 ? '' : 's'}`;
      reset();
      onSaved(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const oldestLabel =
    outstandingOldestFirst.length > 0
      ? `Oldest outstanding first (${outstandingOldestFirst[0].sessionName} ${outstandingOldestFirst[0].termName} → current term)`
      : 'Oldest outstanding first';

  return (
    <>
      <div className={`overlay${open ? ' show' : ''}`} onClick={onClose} />
      <div className={`panel${open ? ' show' : ''}`}>
        <div className="panel-head">
          <div>
            <h3>Record a payment</h3>
            <p>
              For {studentName} · {classLabel}
            </p>
          </div>
          <div className="panel-close" onClick={onClose}>
            ✕
          </div>
        </div>
        <div className="panel-body">
          {outstandingOldestFirst.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--slate-soft)' }}>No outstanding balance for this student.</p>
          ) : (
            <>
              <div className="field">
                <label>Amount received</label>
                <input
                  type="number"
                  placeholder="e.g. 40000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Method</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                    <option value="cash">Cash</option>
                    <option value="bank-transfer">Bank transfer</option>
                    <option value="pos">POS</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Apply to</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'auto' | 'manual')}>
                  <option value="auto">{oldestLabel}</option>
                  <option value="manual">Choose a specific charge</option>
                </select>
              </div>
              {mode === 'manual' && (
                <div className="field">
                  <label>Charge</label>
                  <select value={manualChargeId} onChange={(e) => setManualChargeId(e.target.value)}>
                    <option value="">Select a charge</option>
                    {outstandingOldestFirst.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.feeItemName} — {c.sessionName} {c.termName} (₦{c.balance.toLocaleString()} owed)
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Receipt number</label>
                <input
                  type="text"
                  placeholder="e.g. RCT-2216"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                />
              </div>
              <div className="allocation-note">
                <b>Default rule:</b> payments clear the oldest unpaid balance first. You can override this per
                payment above.
              </div>
              {error && (
                <p className="field-error" style={{ display: 'block', marginTop: 10 }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>
        {outstandingOldestFirst.length > 0 && (
          <div className="panel-foot">
            <button className="btn-primary" style={{ width: '100%' }} onClick={handleSubmit} disabled={saving}>
              {saving ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
