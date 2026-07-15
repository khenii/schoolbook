import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import AppShell from '../components/AppShell';
import { useAppContext } from '../lib/AppContext';
import { useSchoolLedger } from '../hooks/useSchoolLedger';
import { exportToCSV } from '../lib/csv';
import { logAudit } from '../lib/auditLog';

interface FeeItemRow {
  id: string;
  name: string;
}

type Method = 'cash' | 'bank-transfer' | 'pos' | 'other';

const PAGE_SIZE = 15;

function buildPageList(totalPages: number, current: number): (number | '…')[] {
  const pages: (number | '…')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - current) <= 2) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return pages;
}

// "Work down the class list like a paper register" from 10-class-register.html.
// The mockup's entry row is Amount + Add only; the real implementation also
// needs a receipt-number field (every other payment-entry surface in the app
// has one) and a shared method/date pair for the whole session — added as
// two extra .selector-group columns rather than per-row, since in practice a
// teacher recording a register works through one method/date at a time.
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
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const levelId = selectedLevelId || levels[0]?.id || '';
  const feeItemId = selectedFeeItemId || feeItems[0]?.id || '';

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setPage(1);
  }, [levelId, selectedArmId, feeItemId]);

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
  const totalCharged = chargedRows.reduce((sum, r) => sum + r.charged, 0);
  const totalCollected = chargedRows.reduce((sum, r) => sum + r.paid, 0);
  const totalOutstanding = chargedRows.reduce((sum, r) => (r.balance > 0 ? sum + r.balance : sum), 0);
  const fullyPaidCount = chargedRows.filter((r) => r.balance <= 0).length;

  const totalPages = Math.max(1, Math.ceil(roster.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = roster.slice((currentPage - 1) * PAGE_SIZE, (currentPage - 1) * PAGE_SIZE + PAGE_SIZE);

  function handleExport() {
    const levelName = levels.find((l) => l.id === levelId)?.name ?? 'class';
    const feeItemName = feeItems.find((f) => f.id === feeItemId)?.name ?? 'fee-item';
    exportToCSV(
      `class-register-${levelName}-${feeItemName}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/\s+/g, '-'),
      ['Student', 'Class', 'Charged', 'Paid', 'Balance'],
      roster.map((r) => [r.name, r.classLabel, r.hasCharge ? r.charged : '', r.hasCharge ? r.paid : '', r.hasCharge ? r.balance : 'No charge'])
    );
  }

  function setRowInput(studentId: string, field: 'amount' | 'receipt', value: string) {
    setRowInputs((prev) => ({
      ...prev,
      [studentId]: { amount: prev[studentId]?.amount ?? '', receipt: prev[studentId]?.receipt ?? '', [field]: value }
    }));
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
      const paymentId = crypto.randomUUID();
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO payments
             (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
              household_transaction_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            paymentId,
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
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: 'payment.recorded',
          entityType: 'payment',
          entityId: paymentId,
          metadata: { studentId, amount, method, via: 'class-register' }
        });
      });
      setRowInputs((prev) => ({ ...prev, [studentId]: { amount: '', receipt: '' } }));
      setFlashId(studentId);
      setTimeout(() => setFlashId(null), 900);
      setToast(`₦${amount.toLocaleString()} recorded`);
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
      <AppShell title="Class Register" pageClass="page-register">
        <div className="empty-note">
          No current term is set yet. <Link to="/settings">Go to Settings → Sessions</Link> to add one.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Class Register" pageClass="page-register">
      <div className="page-head">
        <div className="eyebrow">Records</div>
        <h2>Treat payments class by class</h2>
        <p>
          Pick a class and a fee item, then work down the list recording payments — like a paper register, but it
          updates every student's balance as you go.
        </p>
      </div>

      <div className="selector-bar">
        <div className="selector-group">
          <label>Class level</label>
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
        <div className="selector-group">
          <label>Arm</label>
          <select value={selectedArmId} onChange={(e) => setSelectedArmId(e.target.value)}>
            <option value="all">All arms</option>
            {armsForLevel.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="selector-divider" />
        <div className="selector-group">
          <label>Fee item</label>
          <select value={feeItemId} onChange={(e) => setSelectedFeeItemId(e.target.value)}>
            {feeItems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="selector-divider" />
        <div className="selector-group">
          <label>Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="cash">Cash</option>
            <option value="bank-transfer">Bank transfer</option>
            <option value="pos">POS</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="selector-group">
          <label>Date paid</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, background: 'var(--paper)', color: 'var(--ink)' }}
          />
        </div>
        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
          <button className="btn-ghost" onClick={handleExport} disabled={roster.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="summary-strip">
        <div className="sstat">
          <div className="label">Students</div>
          <div className="value">{roster.length}</div>
        </div>
        <div className="sstat success">
          <div className="label">Fully paid</div>
          <div className="value">
            {fullyPaidCount} / {chargedRows.length}
          </div>
        </div>
        <div className="sstat">
          <div className="label">Total collected</div>
          <div className="value">₦{totalCollected.toLocaleString()}</div>
        </div>
        <div className="sstat rust">
          <div className="label">Total outstanding</div>
          <div className="value">₦{totalOutstanding.toLocaleString()}</div>
        </div>
      </div>

      <div className="register-wrap">
        <div className="r-row head">
          <div className="col-num">#</div>
          <div className="col-student">Student</div>
          <div className="col-charged">Charged</div>
          <div className="col-paid">Paid</div>
          <div className="col-balance">Balance</div>
          <div className="col-entry">Record a payment</div>
        </div>

        {roster.length === 0 ? (
          <div className="empty-note">No students in this class yet.</div>
        ) : (
          <>
            {pageRows.map((r, i) => (
              <div
                key={r.studentId}
                className={`r-row${r.hasCharge && r.balance <= 0 ? ' fully-paid' : ''}${flashId === r.studentId ? ' paid-flash' : ''}`}
              >
                <div className="col-num">{(currentPage - 1) * PAGE_SIZE + i + 1}</div>
                <div className="col-student">
                  <div className="n">
                    <Link to={`/students/${r.studentId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {r.name}
                    </Link>
                  </div>
                  <div className="c">{r.classLabel}</div>
                </div>
                {!r.hasCharge ? (
                  <div style={{ flex: 3.2, textAlign: 'right', color: 'var(--slate-soft)', fontSize: 12 }}>
                    No charge for this fee item this term
                  </div>
                ) : (
                  <>
                    <div className="col-charged">₦{r.charged.toLocaleString()}</div>
                    <div className="col-paid">₦{r.paid.toLocaleString()}</div>
                    <div className="col-balance">
                      {r.balance > 0 ? (
                        <span className="bal-tag owed">₦{r.balance.toLocaleString()}</span>
                      ) : (
                        <span className="bal-tag clear">Cleared</span>
                      )}
                    </div>
                    <div className="col-entry">
                      {r.balance > 0 ? (
                        <div>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button className="fill-btn" onClick={() => fillFull(r.studentId, r.balance)}>
                              Full
                            </button>
                            <input
                              type="number"
                              placeholder="Amount"
                              value={rowInputs[r.studentId]?.amount ?? ''}
                              onChange={(e) => setRowInput(r.studentId, 'amount', e.target.value)}
                              style={{ width: 88 }}
                            />
                            <input
                              type="text"
                              placeholder="Receipt #"
                              value={rowInputs[r.studentId]?.receipt ?? ''}
                              onChange={(e) => setRowInput(r.studentId, 'receipt', e.target.value)}
                              style={{ width: 80 }}
                            />
                            <button
                              className="add-btn"
                              onClick={() => recordPayment(r.studentId, r.chargeId, r.balance)}
                              disabled={saving === r.studentId}
                            >
                              {saving === r.studentId ? '…' : 'Add'}
                            </button>
                          </div>
                          {rowError[r.studentId] && (
                            <div style={{ color: 'var(--rust)', fontSize: 11, marginTop: 4, textAlign: 'right' }}>
                              {rowError[r.studentId]}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--success)', fontSize: 11.5, fontWeight: 600 }}>✓ No balance</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            <div className="totals-row">
              <div className="col-num" />
              <div className="col-student">Totals for this selection</div>
              <div className="col-charged">₦{totalCharged.toLocaleString()}</div>
              <div className="col-paid">₦{totalCollected.toLocaleString()}</div>
              <div className="col-balance">₦{totalOutstanding.toLocaleString()}</div>
              <div className="col-entry" />
            </div>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="pagination-bar">
          <button className="page-btn" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
            ← Prev
          </button>
          {buildPageList(totalPages, currentPage).map((p, idx) =>
            p === '…' ? (
              <span className="page-ellipsis" key={`e-${idx}`}>
                …
              </span>
            ) : (
              <button
                key={p}
                className={`page-btn${p === currentPage ? ' active' : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            )
          )}
          <button className="page-btn" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
            Next →
          </button>
        </div>
      )}

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </AppShell>
  );
}
