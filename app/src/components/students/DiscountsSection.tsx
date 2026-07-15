import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';

interface DiscountRow {
  id: string;
  fee_item_id: string;
  type: 'percent' | 'fixed';
  value: number;
  reason: string;
  active: number;
  created_at: string;
  removed_at: string | null;
}

interface FeeItemRow {
  id: string;
  name: string;
}

type DiscountType = 'percent' | 'fixed';

export default function DiscountsSection({ studentId }: { studentId: string }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: discounts } = useQuery<DiscountRow>(
    'SELECT * FROM discounts WHERE student_id = ? ORDER BY created_at DESC',
    [studentId]
  );
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items ORDER BY name ASC');

  const feeItemName = (id: string) => feeItems.find((f) => f.id === id)?.name ?? id;

  const active = discounts.filter((d) => d.active);
  const removed = discounts.filter((d) => !d.active);

  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [feeItemId, setFeeItemId] = useState('');
  const [type, setType] = useState<DiscountType>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  function resetForm() {
    setAdding(false);
    setFeeItemId('');
    setType('percent');
    setValue('');
    setReason('');
    setError(null);
  }

  async function handleAdd() {
    setError(null);
    const numValue = Number(value);
    if (!feeItemId) {
      setError('Choose a fee item.');
      return;
    }
    if (!numValue || numValue <= 0) {
      setError('Enter a value greater than zero.');
      return;
    }
    if (type === 'percent' && numValue > 100) {
      setError('A percentage discount can\'t exceed 100.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }
    if (active.some((d) => d.fee_item_id === feeItemId)) {
      setError('This student already has an active discount on that fee item — remove it first to replace it.');
      return;
    }
    setSaving(true);
    try {
      await db.execute(
        `INSERT INTO discounts (id, school_id, student_id, fee_item_id, type, value, reason, applied_by, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [crypto.randomUUID(), schoolId, studentId, feeItemId, type, numValue, reason.trim(), account.id, new Date().toISOString()]
      );
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(d: DiscountRow) {
    setRemoving(d.id);
    try {
      await db.execute('UPDATE discounts SET active = 0, removed_at = ? WHERE id = ?', [
        new Date().toISOString(),
        d.id
      ]);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div style={{ margin: '1.5rem 0' }}>
      <h2 style={{ marginBottom: 4 }}>Discounts</h2>
      <p style={{ fontSize: 12, color: '#888', marginTop: 0 }}>
        Standing rules, not one-time adjustments — they apply the next time a charge is generated for this student
        (enrollment or a new term's recurring charges), not to charges that already exist. To adjust a charge that's
        already been created, use a write-off instead.
      </p>

      {active.length === 0 ? (
        <p style={{ fontSize: 12.5, color: '#888' }}>No active discounts.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12 }}>
              <th style={{ padding: 6 }}>Fee item</th>
              <th style={{ padding: 6 }}>Discount</th>
              <th style={{ padding: 6 }}>Reason</th>
              <th style={{ padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {active.map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #eee', fontSize: 13 }}>
                <td style={{ padding: 6 }}>{feeItemName(d.fee_item_id)}</td>
                <td style={{ padding: 6 }}>{d.type === 'percent' ? `${d.value}%` : `₦${d.value.toLocaleString()}`}</td>
                <td style={{ padding: 6, color: '#555' }}>{d.reason}</td>
                <td style={{ padding: 6 }}>
                  <button onClick={() => handleRemove(d)} disabled={removing === d.id} style={{ fontSize: 11 }}>
                    {removing === d.id ? '…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={feeItemId} onChange={(e) => setFeeItemId(e.target.value)}>
            <option value="" disabled>
              Fee item
            </option>
            {feeItems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as DiscountType)}>
            <option value="percent">Percent</option>
            <option value="fixed">Fixed amount</option>
          </select>
          <input
            type="number"
            placeholder={type === 'percent' ? 'e.g. 10' : 'e.g. 5000'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: 100 }}
          />
          <input
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button onClick={handleAdd} disabled={saving}>
            {saving ? 'Saving…' : 'Add discount'}
          </button>
          <button type="button" onClick={resetForm}>
            Cancel
          </button>
          {error && <p style={{ color: 'crimson', fontSize: 12, width: '100%', margin: 0 }}>{error}</p>}
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ marginTop: 8, fontSize: 12.5 }}>
          + Add discount
        </button>
      )}

      {removed.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setShowRemoved((v) => !v)} style={{ fontSize: 12 }}>
            {showRemoved ? 'Hide' : 'Show'} removed discounts ({removed.length})
          </button>
          {showRemoved && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <tbody>
                {removed.map((d) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #eee', fontSize: 12.5, color: '#888' }}>
                    <td style={{ padding: 6 }}>{feeItemName(d.fee_item_id)}</td>
                    <td style={{ padding: 6 }}>
                      {d.type === 'percent' ? `${d.value}%` : `₦${d.value.toLocaleString()}`}
                    </td>
                    <td style={{ padding: 6 }}>{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
