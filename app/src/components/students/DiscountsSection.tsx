import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { logAudit } from '../../lib/auditLog';

interface DiscountRow {
  id: string;
  fee_item_id: string;
  type: 'percent' | 'fixed';
  value: number;
  reason: string;
  applied_by: string | null;
  active: number;
  created_at: string;
  removed_at: string | null;
}

interface FeeItemRow {
  id: string;
  name: string;
}

interface AccountRow {
  id: string;
  email: string;
}

type DiscountType = 'percent' | 'fixed';

// "Discounts & waivers" section + its slide-over "Add a discount" panel,
// from 05-student-profile.html. Standing rules only take effect the next
// time a charge is generated (enrollment or a new term) — never rewriting
// a charge that already exists, so the mockup's "apply to this term's
// charge right now" checkbox is intentionally left out here; to adjust an
// existing charge, use a write-off instead (spec §3.10).
export default function DiscountsSection({ studentId }: { studentId: string }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: discounts } = useQuery<DiscountRow>(
    'SELECT * FROM discounts WHERE student_id = ? ORDER BY created_at DESC',
    [studentId]
  );
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items ORDER BY name ASC');
  const { data: accounts } = useQuery<AccountRow>('SELECT id, email FROM accounts');

  const feeItemName = (id: string) => feeItems.find((f) => f.id === id)?.name ?? id;
  const byLabel = (id: string | null) => accounts.find((a) => a.id === id)?.email ?? 'Unknown';

  const active = discounts.filter((d) => d.active);
  const removed = discounts.filter((d) => !d.active);

  const [showRemoved, setShowRemoved] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [feeItemId, setFeeItemId] = useState('');
  const [type, setType] = useState<DiscountType>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  function openPanel() {
    setFeeItemId('');
    setType('percent');
    setValue('');
    setReason('');
    setError(null);
    setPanelOpen(true);
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
      setError("A percentage discount can't exceed 100.");
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required before a discount can be applied.');
      return;
    }
    if (active.some((d) => d.fee_item_id === feeItemId)) {
      setError('This student already has an active discount on that fee item — remove it first to replace it.');
      return;
    }
    setSaving(true);
    try {
      const discountId = crypto.randomUUID();
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO discounts (id, school_id, student_id, fee_item_id, type, value, reason, applied_by, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [discountId, schoolId, studentId, feeItemId, type, numValue, reason.trim(), account.id, new Date().toISOString()]
        );
        await logAudit(tx, {
          schoolId,
          actorId: account.id,
          action: 'discount.applied',
          entityType: 'discount',
          entityId: discountId,
          metadata: { studentId, feeItemId, type, value: numValue, reason: reason.trim() }
        });
      });
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(d: DiscountRow) {
    setRemoving(d.id);
    try {
      await db.writeTransaction(async (tx) => {
        await tx.execute('UPDATE discounts SET active = 0, removed_at = ? WHERE id = ?', [
          new Date().toISOString(),
          d.id
        ]);
        await logAudit(tx, {
          schoolId,
          actorId: account.id,
          action: 'discount.removed',
          entityType: 'discount',
          entityId: d.id,
          metadata: { studentId, feeItemId: d.fee_item_id }
        });
      });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        <div>
          <h3>Discounts &amp; waivers</h3>
          <p>
            Standing rules that reduce what this student is charged going forward — different from a write-off,
            which forgives an amount already charged.
          </p>
        </div>
        <button className="btn-ghost" onClick={openPanel}>
          + Add discount
        </button>
      </div>

      {active.length === 0 ? (
        <div className="no-discounts">No standing discounts on this record.</div>
      ) : (
        active.map((d) => (
          <div className="discount-card" key={d.id}>
            <div className="discount-icon">%</div>
            <div className="discount-body">
              <div className="discount-top">
                <div className="discount-fee">{feeItemName(d.fee_item_id)}</div>
                <div className="discount-val">
                  {d.type === 'percent' ? `${d.value}% off` : `₦${d.value.toLocaleString()} off`} every charge
                </div>
              </div>
              <div className="discount-reason">"{d.reason}"</div>
              <div className="discount-meta">
                {byLabel(d.applied_by ?? null)} · {new Date(d.created_at).toLocaleDateString()}
              </div>
            </div>
            <div
              className="discount-remove"
              onClick={() => handleRemove(d)}
              title="Remove this standing discount"
              style={{ opacity: removing === d.id ? 0.5 : 1 }}
            >
              ✕
            </div>
          </div>
        ))
      )}

      {removed.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <span className="mini-btn" onClick={() => setShowRemoved((v) => !v)}>
            {showRemoved ? 'Hide' : 'Show'} removed discounts ({removed.length})
          </span>
          {showRemoved &&
            removed.map((d) => (
              <div className="discount-card" key={d.id} style={{ background: 'var(--paper)', borderColor: 'var(--line)', opacity: 0.75 }}>
                <div className="discount-icon">%</div>
                <div className="discount-body">
                  <div className="discount-top">
                    <div className="discount-fee">{feeItemName(d.fee_item_id)}</div>
                    <div className="discount-val" style={{ color: 'var(--slate-soft)' }}>
                      {d.type === 'percent' ? `${d.value}% off` : `₦${d.value.toLocaleString()} off`}
                    </div>
                  </div>
                  <div className="discount-reason">"{d.reason}"</div>
                  <div className="discount-meta">Removed {d.removed_at ? new Date(d.removed_at).toLocaleDateString() : ''}</div>
                </div>
              </div>
            ))}
        </div>
      )}

      <div className={`overlay${panelOpen ? ' show' : ''}`} onClick={() => setPanelOpen(false)} />
      <div className={`panel${panelOpen ? ' show' : ''}`}>
        <div className="panel-head">
          <div>
            <h3>Add a discount or waiver</h3>
            <p>A standing rule — applies to future charges for this fee item.</p>
          </div>
          <div className="panel-close" onClick={() => setPanelOpen(false)}>
            ✕
          </div>
        </div>
        <div className="panel-body">
          <div className="field">
            <label>Fee item</label>
            <select value={feeItemId} onChange={(e) => setFeeItemId(e.target.value)}>
              <option value="">Choose…</option>
              {feeItems.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Discount type</label>
              <select value={type} onChange={(e) => setType(e.target.value as DiscountType)}>
                <option value="percent">Percentage off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </div>
            <div className="field">
              <label>Value</label>
              <input
                type="number"
                placeholder={type === 'percent' ? 'e.g. 10' : 'e.g. 5000'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>
              Reason <span className="required-mark">*required</span>
            </label>
            <textarea
              placeholder="e.g. Staff child — 10% discount per school policy."
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
          <button className="btn-primary" style={{ width: '100%' }} onClick={handleAdd} disabled={saving}>
            {saving ? 'Saving…' : 'Add discount'}
          </button>
        </div>
      </div>
    </div>
  );
}
