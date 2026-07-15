import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useSchoolLedger } from '../hooks/useSchoolLedger';

interface FeeItemRow {
  id: string;
  name: string;
}

type Method = 'cash' | 'bank-transfer' | 'pos' | 'other';

const cardStyle: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '12px 16px',
  flex: 1
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#64748b',
  marginBottom: 6
};

export default function ClassRegisterPage() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const { levels, arms, enrolledStudents, currentTerm, chargeBalances, classLabel } = useSchoolLedger();
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items ORDER BY name ASC');

  const [selectedLevelId, setSelectedLevelId] = useState<string>('');
  const [selectedArmId, setSelectedArmId] = useState<string>('all');
  const [selectedFeeItemId, setSelectedFeeItemId] = useState<string>('');
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rowInputs, setRowInputs] = useState<Record<string, { amount: string; receipt: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const levelId = selectedLevelId || levels[0]?.id || '';
  const feeItemId = selectedFeeItemId || feeItems[0]?.id || '';

  const armsForLevel = useMemo(
    () => arms.filter((a) => a.class_level_id === levelId && (!currentTerm || a.session_id === currentTerm.session_id)),
    [arms, levelId, currentTerm]
  );

  const roster = useMemo(() => {
    if (!levelId || !currentTerm) return [];
    const armIds = selectedArmId === 'all' ? new Set(armsForLevel.map((a) => a.id)) : new Set([selectedArmId]);
    const students = enrolledStudents.filter((s) => s.current_class_arm_id && armIds.has(s.current_class_arm_id));
    students.sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));

    return students.map((s) => {
      const matches = chargeBalances.filter(
        (c) => c.student_id === s.id && c.fee_item_id === feeItemId && c.term_id === currentTerm.id
      );
      const charged = matches.reduce((sum, c) => sum + c.amount_expected, 0);
      const paid = matches.reduce((sum, c) => sum + c.paid, 0);
      const balance = charged - paid;
      // If a student somehow has more than one charge for this fee item in
      // this term (shouldn't happen, but the duplicate-fee-item bug showed
      // it's possible), payments still need one real charge_id to attach
      // to — use the first as the entry target.
      const chargeId = matches[0]?.id ?? null;
      return {
        studentId: s.id,
        name: `${s.last_name} ${s.first_name}`,
        classLabel: classLabel(s.current_class_arm_id),
        chargeId,
        hasCharge: matches.length > 0,
        charged,
        paid,
        balance
      };
    });
  }, [levelId, currentTerm, selectedArmId, armsForLevel, enrolledStudents, chargeBalances, feeItemId, classLabel]);

  const chargedRows = roster.filter((r) => r.hasCharge);
  const totalCollected = chargedRows.reduce((sum, r) => sum + r.paid, 0);
  const totalOutstanding = chargedRows.reduce((sum, r) => (r.balance > 0 ? sum + r.balance : sum), 0);
  const fullyPaidCount = chargedRows.filter((r) => r.balance <= 0).length;

  function setRowInput(studentId: string, field: 'amount' | 'receipt', value: string) {
    setRowInputs((prev) => ({ ...prev, [studentId]: { ...prev[studentId], amount: prev[studentId]?.amount ?? '', receipt: prev[studentId]?.receipt ?? '', [field]: value } }));
  }

  function fillFull(studentId: string, balance: number) {
    setRowInput(studentId, 'amount', String(balance));
  }

  async function recordPayment(studentId: string, chargeId: string | null, balance: number) {
    setRowError((prev) => ({ ...prev, [studentId]: '' }));
    if (!chargeId) return;
    const input = rowInputs[studentId];
    const amount = Number(input?.amount);
    if (!amount || amount <= 0) {
      setRowError((prev) => ({ ...prev, [studentId]: 'Enter an amount first' }));
      return;
    }
    if (amount > balance) {
      setRowError((prev) => ({ ...prev, [studentId]: `Exceeds balance (₦${balance.toLocaleString()})` }));
      return;
    }
    setSaving(studentId);
    try {
      await db.execute(
        `INSERT INTO payments
           (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
            household_transaction_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          account.school_id,
          studentId,
          chargeId,
          amount,
          date,
          method,
          input?.receipt?.trim() || null,
          account.id,
          crypto.randomUUID(),
          new Date().toISOString()
        ]
      );
      setRowInputs((prev) => ({ ...prev, [studentId]: { amount: '', receipt: '' } }));
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [studentId]: err instanceof Error ? err.message : 'Something went wrong'
      }));
    } finally {
      setSaving(null);
    }
  }

  if (!currentTerm) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem' }}>
        <p>
          <Link to="/">← Back to dashboard</Link>
        </p>
        <h1>Class Register</h1>
        <p style={{ color: '#64748b' }}>
          No current term is set yet. <Link to="/settings">Go to Settings → Sessions</Link> to add one.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
      <h1 style={{ marginBottom: 2 }}>Class Register</h1>
      <p style={{ color: '#64748b', margin: 0 }}>
        Pick a class and a fee item, then work down the list recording payments — like a paper register, but every
        balance updates as you go. Current term: {currentTerm.name}.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          margin: '1.25rem 0',
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '14px 16px'
        }}
      >
        <div>
          <div style={labelStyle}>Class level</div>
          <select
            value={levelId}
            onChange={(e) => {
              setSelectedLevelId(e.target.value);
              setSelectedArmId('all');
            }}
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Arm</div>
          <select value={selectedArmId} onChange={(e) => setSelectedArmId(e.target.value)}>
            <option value="all">All arms</option>
            {armsForLevel.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Fee item</div>
          <select value={feeItemId} onChange={(e) => setSelectedFeeItemId(e.target.value)}>
            {feeItems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 1, height: 36, background: '#e2e8f0' }} />
        <div>
          <div style={labelStyle}>Method</div>
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="cash">Cash</option>
            <option value="bank-transfer">Bank transfer</option>
            <option value="pos">POS</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <div style={labelStyle}>Date paid</div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Students</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{roster.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Fully paid</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#3A7D5C' }}>
            {fullyPaidCount} / {chargedRows.length}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Total collected</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>₦{totalCollected.toLocaleString()}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Total outstanding</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#B84C3E' }}>₦{totalOutstanding.toLocaleString()}</div>
        </div>
      </div>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            padding: '9px 16px',
            background: '#f8fafc',
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: '#64748b',
            fontWeight: 600,
            gap: 10
          }}
        >
          <div style={{ flex: 1.6 }}>Student</div>
          <div style={{ flex: 0.9, textAlign: 'right' }}>Charged</div>
          <div style={{ flex: 0.9, textAlign: 'right' }}>Paid</div>
          <div style={{ flex: 0.9, textAlign: 'right' }}>Balance</div>
          <div style={{ flex: 2, textAlign: 'right' }}>Record a payment</div>
        </div>

        {roster.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            No students in this class yet.
          </div>
        )}

        {roster.map((r) => (
          <div
            key={r.studentId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              borderBottom: '1px solid #eee',
              fontSize: 12.5,
              background: r.hasCharge && r.balance <= 0 ? '#FCFEFC' : undefined
            }}
          >
            <div style={{ flex: 1.6 }}>
              <div style={{ fontWeight: 600 }}>
                <Link to={`/students/${r.studentId}`} style={{ color: 'inherit' }}>
                  {r.name}
                </Link>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{r.classLabel}</div>
            </div>
            {!r.hasCharge ? (
              <div style={{ flex: 3.8, textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>
                No charge for this fee item this term
              </div>
            ) : (
              <>
                <div style={{ flex: 0.9, textAlign: 'right', color: '#64748b' }}>₦{r.charged.toLocaleString()}</div>
                <div style={{ flex: 0.9, textAlign: 'right', fontWeight: 600 }}>₦{r.paid.toLocaleString()}</div>
                <div style={{ flex: 0.9, textAlign: 'right' }}>
                  {r.balance > 0 ? (
                    <span style={{ color: '#B84C3E', fontWeight: 700, fontSize: 11.5 }}>
                      ₦{r.balance.toLocaleString()}
                    </span>
                  ) : (
                    <span style={{ color: '#3A7D5C', fontWeight: 700, fontSize: 11.5 }}>Cleared</span>
                  )}
                </div>
                <div style={{ flex: 2, textAlign: 'right' }}>
                  {r.balance > 0 ? (
                    <div>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => fillFull(r.studentId, r.balance)} style={{ fontSize: 11 }}>
                          Full
                        </button>
                        <input
                          type="number"
                          placeholder="Amount"
                          value={rowInputs[r.studentId]?.amount ?? ''}
                          onChange={(e) => setRowInput(r.studentId, 'amount', e.target.value)}
                          style={{ width: 90 }}
                        />
                        <input
                          placeholder="Receipt #"
                          value={rowInputs[r.studentId]?.receipt ?? ''}
                          onChange={(e) => setRowInput(r.studentId, 'receipt', e.target.value)}
                          style={{ width: 90 }}
                        />
                        <button
                          onClick={() => recordPayment(r.studentId, r.chargeId, r.balance)}
                          disabled={saving === r.studentId}
                        >
                          {saving === r.studentId ? '…' : 'Add'}
                        </button>
                      </div>
                      {rowError[r.studentId] && (
                        <div style={{ color: 'crimson', fontSize: 11, marginTop: 4 }}>{rowError[r.studentId]}</div>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: '#3A7D5C', fontSize: 11.5, fontWeight: 600 }}>✓ No balance</span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
