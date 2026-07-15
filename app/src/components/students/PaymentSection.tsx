import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';

interface ChargeRow {
  id: string;
  fee_item_id: string;
  session_id: string;
  term_id: string;
  amount_expected: number;
}

interface PaymentRow {
  charge_id: string;
  amount_paid: number;
}

interface FeeItemRow {
  id: string;
  name: string;
}

interface TermRow {
  id: string;
  name: string;
  created_at: string;
}

interface SessionRow {
  id: string;
  name: string;
  created_at: string;
}

type Method = 'cash' | 'bank-transfer' | 'pos' | 'other';

export default function PaymentSection({ studentId }: { studentId: string }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: charges } = useQuery<ChargeRow>(
    'SELECT id, fee_item_id, session_id, term_id, amount_expected FROM charges WHERE student_id = ?',
    [studentId]
  );
  const { data: payments } = useQuery<PaymentRow>(
    'SELECT charge_id, amount_paid FROM payments WHERE student_id = ?',
    [studentId]
  );
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items');
  const { data: terms } = useQuery<TermRow>('SELECT id, name, created_at FROM terms');
  const { data: sessions } = useQuery<SessionRow>('SELECT id, name, created_at FROM sessions');

  const paidByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.charge_id, (map.get(p.charge_id) ?? 0) + p.amount_paid);
    }
    return map;
  }, [payments]);

  const balanceFor = (charge: ChargeRow) => charge.amount_expected - (paidByCharge.get(charge.id) ?? 0);

  // Oldest-first per spec §3.3, using session/term creation order rather
  // than the charge's own created_at — a recurring charge generated late
  // for Term 1 should still count as older debt than a Term 2 charge.
  const sortKey = (c: ChargeRow) => {
    const sessionCreated = sessions.find((s) => s.id === c.session_id)?.created_at ?? '';
    const termCreated = terms.find((t) => t.id === c.term_id)?.created_at ?? '';
    return `${sessionCreated}__${termCreated}`;
  };

  const outstanding = charges
    .filter((c) => balanceFor(c) > 0)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const totalOutstanding = outstanding.reduce((sum, c) => sum + balanceFor(c), 0);

  const chargeLabel = (c: ChargeRow) => {
    const feeName = feeItems.find((f) => f.id === c.fee_item_id)?.name ?? c.fee_item_id;
    const termName = terms.find((t) => t.id === c.term_id)?.name ?? '';
    const sessionName = sessions.find((s) => s.id === c.session_id)?.name ?? '';
    return `${feeName} — ${sessionName} ${termName} (₦${balanceFor(c).toLocaleString()} owed)`;
  };

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
      const charge = outstanding.find((c) => c.id === manualChargeId);
      if (!charge) {
        setError('Choose which charge this payment applies to.');
        return;
      }
      if (total > balanceFor(charge)) {
        setError(`Amount exceeds this charge's outstanding balance (₦${balanceFor(charge).toLocaleString()}).`);
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
        for (const charge of outstanding) {
          if (remaining <= 0) break;
          const owed = balanceFor(charge);
          const allocated = Math.min(owed, remaining);
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
        Total outstanding: ₦{totalOutstanding.toLocaleString()} across {outstanding.length} charge
        {outstanding.length === 1 ? '' : 's'}. By default, payments clear the oldest debt first; switch to manual to
        target one specific charge instead.
      </p>

      {outstanding.length === 0 ? (
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
              {outstanding.map((c) => (
                <option key={c.id} value={c.id}>
                  {chargeLabel(c)}
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
