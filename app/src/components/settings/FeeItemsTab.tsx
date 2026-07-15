import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { logAudit } from '../../lib/auditLog';

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

const ICONS: Record<string, string> = {
  'admission form': '✎',
  'school fees': '₦',
  uniform: '⚏',
  sportwear: '⚽'
};
function iconFor(name: string) {
  return ICONS[name.trim().toLowerCase()] ?? '₦';
}

// The "fee-card" family from 09-settings.html. The mockup's price-varies
// toggle is UI-only there (its demo data already has a `varyByClass` flag);
// the real schema always stores one price per class level per fee item, so
// "flat" is just "every level happens to share the same amount." The
// checkbox here is local display state seeded from that — checking it
// reveals the full per-class table, unchecking it collapses back to a
// single input that fans the same amount out to every level, matching the
// mockup's interaction without needing a schema change.
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
  const [varyUi, setVaryUi] = useState<Record<string, boolean>>({});

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
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'fee_item.added',
        entityType: 'fee_item',
        entityId: id,
        metadata: { name }
      });
    });
    setNewFeeName('');
    setAddingFee(false);
    setOpenId(id);
  }

  async function removeFeeItem(id: string) {
    if (!confirm('Remove this fee item and its pricing? This does not affect charges already generated.')) return;
    const feeName = feeItems.find((f) => f.id === id)?.name;
    await db.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM fee_item_pricing WHERE fee_item_id = ?', [id]);
      await tx.execute('DELETE FROM fee_items WHERE id = ?', [id]);
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'fee_item.removed',
        entityType: 'fee_item',
        entityId: id,
        metadata: { name: feeName }
      });
    });
  }

  async function setType(id: string, type: FeeItem['type']) {
    await db.execute('UPDATE fee_items SET type = ? WHERE id = ?', [type, id]);
  }

  async function setAppliesTo(id: string, appliesTo: FeeItem['applies_to']) {
    await db.execute('UPDATE fee_items SET applies_to = ? WHERE id = ?', [appliesTo, id]);
  }

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

  async function applyFlatPrice(feeItemId: string, rawAmount?: string) {
    const raw = rawAmount ?? flatPriceInput[feeItemId];
    const amount = Number(raw);
    if (!raw || Number.isNaN(amount)) return;
    for (const level of sortedLevels) {
      await setPrice(feeItemId, level.id, amount);
    }
  }

  return (
    <div>
      <div className="tab-subhead">
        <div>
          <p>
            Set each item as one-off or per-term, decide who it applies to, and either give it one price for every
            class or vary the price by class level.
          </p>
        </div>
      </div>

      {feeItems.map((fee) => {
        const isOpen = openId === fee.id;
        const rows = pricingFor(fee.id);
        const allSame = rows.length > 0 && rows.every((r) => r.amount === rows[0].amount);
        const isVarying = varyUi[fee.id] ?? !allSame;

        return (
          <div className={`fee-card${isOpen ? ' open' : ''}`} key={fee.id}>
            <div className="fee-head" onClick={() => setOpenId(isOpen ? null : fee.id)}>
              <div className="fee-icon">{iconFor(fee.name)}</div>
              <div className="fee-title">
                <div className="name">{fee.name}</div>
                <div className="sub">
                  {allSame ? `₦${(rows[0]?.amount ?? 0).toLocaleString()} flat` : 'Price varies by class level'}
                </div>
              </div>
              <div className="badge-row">
                <div className={`badge ${fee.type === 'one-off' ? 'oneoff' : 'recurring'}`}>
                  {fee.type === 'one-off' ? 'ONE-OFF' : 'PER TERM'}
                </div>
                <div className={`badge ${fee.applies_to === 'new-students-only' ? 'new' : 'all'}`}>
                  {fee.applies_to === 'new-students-only' ? 'NEW STUDENTS' : 'ALL STUDENTS'}
                </div>
              </div>
              <div className="chevron">▸</div>
            </div>

            {isOpen && (
              <div className="fee-body">
                <div className="settings-row">
                  <div className="setting-group">
                    <label className="group-label">Charge type</label>
                    <div className="segmented">
                      <div className={fee.type === 'one-off' ? 'sel' : ''} onClick={() => setType(fee.id, 'one-off')}>
                        One-off
                      </div>
                      <div className={fee.type === 'recurring' ? 'sel' : ''} onClick={() => setType(fee.id, 'recurring')}>
                        Per term
                      </div>
                    </div>
                  </div>
                  <div className="setting-group">
                    <label className="group-label">Applies to</label>
                    <div className="segmented">
                      <div
                        className={fee.applies_to === 'all-students' ? 'sel' : ''}
                        onClick={() => setAppliesTo(fee.id, 'all-students')}
                      >
                        All students
                      </div>
                      <div
                        className={fee.applies_to === 'new-students-only' ? 'sel' : ''}
                        onClick={() => setAppliesTo(fee.id, 'new-students-only')}
                      >
                        New students only
                      </div>
                    </div>
                  </div>
                </div>

                <label className="group-label">Pricing</label>
                <div className="price-mode-toggle">
                  <input
                    type="checkbox"
                    id={`vary-${fee.id}`}
                    checked={isVarying}
                    onChange={(e) => setVaryUi((prev) => ({ ...prev, [fee.id]: e.target.checked }))}
                  />
                  <label htmlFor={`vary-${fee.id}`}>Price varies by class level</label>
                </div>

                {isVarying ? (
                  <div className="price-table">
                    {sortedLevels.map((level) => (
                      <div className="price-row" key={level.id}>
                        <div className="lvl">{level.name}</div>
                        <span className="cur">₦</span>
                        <input
                          type="number"
                          value={priceFor(fee.id, level.id)}
                          onChange={(e) => setPrice(fee.id, level.id, Number(e.target.value) || 0)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flat-price">
                    <span>₦</span>
                    <input
                      type="number"
                      value={flatPriceInput[fee.id] ?? String(rows[0]?.amount ?? 0)}
                      onChange={(e) => {
                        setFlatPriceInput((prev) => ({ ...prev, [fee.id]: e.target.value }));
                        applyFlatPrice(fee.id, e.target.value);
                      }}
                    />
                  </div>
                )}

                <div
                  className="mini-btn"
                  style={{ color: 'var(--rust)', marginTop: 14, display: 'inline-block' }}
                  onClick={() => removeFeeItem(fee.id)}
                >
                  Remove this fee item
                </div>
              </div>
            )}
          </div>
        );
      })}

      {addingFee ? (
        <div className="add-level-row">
          <input
            type="text"
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
            style={{ color: 'var(--slate-soft)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="add-fee-card" onClick={() => setAddingFee(true)}>
          + Add another fee item
        </div>
      )}
      {addFeeError && (
        <p className="field-error" style={{ display: 'block' }}>
          {addFeeError}
        </p>
      )}
    </div>
  );
}
