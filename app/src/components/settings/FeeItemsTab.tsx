import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';

interface ClassLevel {
  id: string;
  name: string;
  sort_order: number;
}

interface FeeItem {
  id: string;
  name: string;
  type: 'one-off' | 'recurring';
  applies_to: 'new-students-only' | 'all-students';
  created_at: string;
}

interface FeeItemPricing {
  id: string;
  fee_item_id: string;
  class_level_id: string;
  amount: number;
}

export default function FeeItemsTab() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: classLevels } = useQuery<ClassLevel>('SELECT * FROM class_levels ORDER BY sort_order ASC');
  const { data: feeItems } = useQuery<FeeItem>('SELECT * FROM fee_items ORDER BY created_at ASC');
  const { data: pricing } = useQuery<FeeItemPricing>('SELECT * FROM fee_item_pricing');

  const [openId, setOpenId] = useState<string | null>(null);
  const [newFeeName, setNewFeeName] = useState('');
  const [addingFee, setAddingFee] = useState(false);
  const [addFeeError, setAddFeeError] = useState<string | null>(null);
  const [flatPriceInput, setFlatPriceInput] = useState<Record<string, string>>({});

  const sortedLevels = [...classLevels].sort((a, b) => a.sort_order - b.sort_order);
  const pricingFor = (feeItemId: string) => pricing.filter((p) => p.fee_item_id === feeItemId);
  const priceFor = (feeItemId: string, classLevelId: string) =>
    pricingFor(feeItemId).find((p) => p.class_level_id === classLevelId)?.amount ?? 0;

  async function addFeeItem() {
    const name = newFeeName.trim();
    if (!name) return;
    setAddFeeError(null);
    const isDuplicate = feeItems.some((f) => f.name.trim().toLowerCase() === name.toLowerCase());
    if (isDuplicate) {
      setAddFeeError(`"${name}" already exists — change its price instead of adding a duplicate.`);
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        'INSERT INTO fee_items (id, school_id, name, type, applies_to, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, schoolId, name, 'recurring', 'all-students', now]
      );
      for (const level of sortedLevels) {
        await tx.execute(
          'INSERT INTO fee_item_pricing (id, school_id, fee_item_id, class_level_id, amount, created_at) VALUES (?, ?, ?, ?, 0, ?)',
          [crypto.randomUUID(), schoolId, id, level.id, now]
        );
      }
    });
    setNewFeeName('');
    setAddingFee(false);
    setOpenId(id);
  }

  async function removeFeeItem(id: string) {
    if (!confirm('Remove this fee item and its pricing? This does not affect charges already generated.')) return;
    await db.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM fee_item_pricing WHERE fee_item_id = ?', [id]);
      await tx.execute('DELETE FROM fee_items WHERE id = ?', [id]);
    });
  }

  async function setType(id: string, type: FeeItem['type']) {
    await db.execute('UPDATE fee_items SET type = ? WHERE id = ?', [type, id]);
  }

  async function setAppliesTo(id: string, appliesTo: FeeItem['applies_to']) {
    await db.execute('UPDATE fee_items SET applies_to = ? WHERE id = ?', [appliesTo, id]);
  }

  // Handles both: a class level that already has a pricing row (update),
  // and one that doesn't yet — e.g. a level added after this fee item was
  // created (insert). Checked in JS rather than a SQL upsert since PowerSync's
  // local schema doesn't necessarily carry the same unique constraint Postgres
  // enforces server-side.
  async function setPrice(feeItemId: string, classLevelId: string, amount: number) {
    const existing = pricingFor(feeItemId).find((p) => p.class_level_id === classLevelId);
    if (existing) {
      await db.execute('UPDATE fee_item_pricing SET amount = ? WHERE id = ?', [amount, existing.id]);
    } else {
      const now = new Date().toISOString();
      await db.execute(
        'INSERT INTO fee_item_pricing (id, school_id, fee_item_id, class_level_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), schoolId, feeItemId, classLevelId, amount, now]
      );
    }
  }

  async function applyFlatPrice(feeItemId: string) {
    const raw = flatPriceInput[feeItemId];
    const amount = Number(raw);
    if (!raw || Number.isNaN(amount)) return;
    for (const level of sortedLevels) {
      await setPrice(feeItemId, level.id, amount);
    }
  }

  return (
    <div>
      <p style={{ color: 'var(--color-slate)', fontSize: 13 }}>
        Set each item as one-off or per-term, decide who it applies to, and either give it one price for every
        class or vary the price by class level.
      </p>

      {feeItems.map((fee) => {
        const isOpen = openId === fee.id;
        const rows = pricingFor(fee.id);
        const allSame = rows.length > 0 && rows.every((r) => r.amount === rows[0].amount);

        return (
          <div key={fee.id} style={{ border: '1px solid #ddd', borderRadius: 8, marginBottom: 10, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : fee.id)}>
                <strong>{fee.name}</strong>
                <span style={{ color: '#888', marginLeft: 8, fontSize: 12 }}>
                  {allSame ? `₦${(rows[0]?.amount ?? 0).toLocaleString()} flat` : 'varies by class level'}
                </span>
              </div>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#888' }}>
                {fee.type === 'one-off' ? 'ONE-OFF' : 'PER TERM'}
              </span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#888' }}>
                {fee.applies_to === 'new-students-only' ? 'NEW STUDENTS' : 'ALL STUDENTS'}
              </span>
              <button onClick={() => removeFeeItem(fee.id)} style={{ color: 'crimson' }}>
                Remove
              </button>
            </div>

            {isOpen && (
              <div style={{ marginTop: 14, paddingLeft: 12 }}>
                <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>CHARGE TYPE</div>
                    <button
                      disabled={fee.type === 'one-off'}
                      onClick={() => setType(fee.id, 'one-off')}
                      style={{ marginRight: 6 }}
                    >
                      One-off
                    </button>
                    <button disabled={fee.type === 'recurring'} onClick={() => setType(fee.id, 'recurring')}>
                      Per term
                    </button>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>APPLIES TO</div>
                    <button
                      disabled={fee.applies_to === 'all-students'}
                      onClick={() => setAppliesTo(fee.id, 'all-students')}
                      style={{ marginRight: 6 }}
                    >
                      All students
                    </button>
                    <button
                      disabled={fee.applies_to === 'new-students-only'}
                      onClick={() => setAppliesTo(fee.id, 'new-students-only')}
                    >
                      New students only
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>PRICING</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                  <span>Set one price for every level:</span>
                  <span>₦</span>
                  <input
                    type="number"
                    style={{ width: 110 }}
                    value={flatPriceInput[fee.id] ?? ''}
                    onChange={(e) => setFlatPriceInput((prev) => ({ ...prev, [fee.id]: e.target.value }))}
                  />
                  <button onClick={() => applyFlatPrice(fee.id)}>Apply to all</button>
                </div>

                <div style={{ border: '1px solid #eee', borderRadius: 8, maxHeight: 280, overflowY: 'auto' }}>
                  {sortedLevels.map((level) => (
                    <div
                      key={level.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 10px',
                        borderBottom: '1px solid #eee'
                      }}
                    >
                      <span style={{ flex: 1 }}>{level.name}</span>
                      <span style={{ marginRight: 4, color: '#888' }}>₦</span>
                      <input
                        type="number"
                        style={{ width: 110, textAlign: 'right' }}
                        value={priceFor(fee.id, level.id)}
                        onChange={(e) => setPrice(fee.id, level.id, Number(e.target.value) || 0)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {addingFee ? (
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Fee item name, e.g. Textbooks"
              value={newFeeName}
              onChange={(e) => {
                setNewFeeName(e.target.value);
                setAddFeeError(null);
              }}
              autoFocus
            />
            <button onClick={addFeeItem}>Add</button>
            <button
              onClick={() => {
                setAddingFee(false);
                setNewFeeName('');
                setAddFeeError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {addFeeError && <p style={{ color: 'crimson', fontSize: 12.5 }}>{addFeeError}</p>}
        </div>
      ) : (
        <div
          onClick={() => setAddingFee(true)}
          style={{ border: '1.5px dashed #ccc', borderRadius: 8, padding: 12, cursor: 'pointer', color: '#888' }}
        >
          + Add another fee item
        </div>
      )}
    </div>
  );
}
