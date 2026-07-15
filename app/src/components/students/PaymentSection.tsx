import { useState } from 'react';
import type { FormEvent } from 'react';
import { usePowerSync } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { useStudentLedger } from '../../hooks/useStudentLedger';

type Method = 'cash' | 'bank-transfer' | 'pos' | 'other';

export default function PaymentSection({ studentId }: { studentId: string }) {
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
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

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
      });

      setSuccess(
        `₦${total.toLocaleString()} recorded across ${allocations.length} charge${allocations.length === 1 ? '' : 's'}.`
      );
      setAmount('');
      setReceiptNumber('');
      setManualChargeId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>Record a payment</h2>
      <p style={{ fontSize: 12.5, color: '#888' }}>
        Total outstanding: ₦{totalOutstanding.toLocaleString()} across {outstandingOldestFirst.length} charge
        {outstandingOldestFirst.length === 1 ? '' : 's'}. By default, payments clear the oldest debt first; switch
        to manual to target one specific charge instead.
      </p>

      {outstandingOldestFirst.length === 0 ? (
        <p style={{ color: '#888' }}>No outstanding balance.</p>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: 'none', margin: 0 }}>
          <input
            type="number"
            placeholder="Amount received"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="cash">Cash</option>
            <option value="bank-transfer">Bank transfer</option>
            <option value="pos">POS</option>
            <option value="other">Other</option>
          </select>
          <label style={{ fontSize: 12, color: '#888' }}>Date paid</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input
            placeholder="Receipt number (optional)"
            value={receiptNumber}
            onChange={(e) => setReceiptNumber(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 16, margin: '0.5rem 0' }}>
            <label>
              <input type="radio" checked={mode === 'auto'} onChange={() => setMode('auto')} /> Oldest debt first
            </label>
            <label>
              <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Choose a specific
              charge
            </label>
          </div>

          {mode === 'manual' && (
            <select value={manualChargeId} onChange={(e) => setManualChargeId(e.target.value)} required>
              <option value="" disabled>
                Select a charge
              </option>
              {outstandingOldestFirst.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.feeItemName} — {c.sessionName} {c.termName} (₦{c.balance.toLocaleString()} owed)
                </option>
              ))}
            </select>
          )}

          <button type="submit" disabled={saving}>
            {saving ? 'Recording…' : 'Record payment'}
          </button>
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
          {success && <p style={{ color: 'green' }}>{success}</p>}
        </form>
      )}
    </div>
  );
}
