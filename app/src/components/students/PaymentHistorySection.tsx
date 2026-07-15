import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { useStudentLedger } from '../../hooks/useStudentLedger';
import { logAudit } from '../../lib/auditLog';

type PaymentRow = ReturnType<typeof useStudentLedger>['payments'][number];

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  'bank-transfer': 'Bank transfer',
  pos: 'POS',
  other: 'Other'
};

// "Recent payments" table-wrap from 05-student-profile.html, using
// .payment-log-row. Extends the mockup's flat list with what the real app
// already needed: grouping by household_transaction_id (one row per amount
// actually received, matching a receipt book), a void action, and a
// cross-reference note when a sibling's payment covered part of the same
// household transaction.
export default function PaymentHistorySection({ studentId }: { studentId: string }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const { payments, charges } = useStudentLedger(studentId);

  const voidedOriginalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of payments) {
      if (p.void_of_payment_id) ids.add(p.void_of_payment_id);
    }
    return ids;
  }, [payments]);

  const [voiding, setVoiding] = useState<string | null>(null);

  async function handleVoid(r: PaymentRow) {
    const reason = window.prompt(
      `Reason for voiding this ₦${r.amount_paid.toLocaleString()} payment? This can't be undone — it adds a reversal entry, the original stays on record.`
    );
    if (!reason || !reason.trim()) return;
    setVoiding(r.id);
    try {
      const now = new Date().toISOString();
      const voidId = crypto.randomUUID();
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO payments
             (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
              household_transaction_id, void_of_payment_id, void_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            voidId,
            account.school_id,
            studentId,
            r.charge_id,
            -r.amount_paid,
            now.slice(0, 10),
            r.method,
            r.receipt_number ? `VOID-${r.receipt_number}` : null,
            account.id,
            r.household_transaction_id,
            r.id,
            reason.trim(),
            now
          ]
        );
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: 'payment.voided',
          entityType: 'payment',
          entityId: r.id,
          metadata: { studentId, amount: r.amount_paid, reason: reason.trim() }
        });
      });
    } finally {
      setVoiding(null);
    }
  }

  const chargeFor = (chargeId: string) => charges.find((x) => x.id === chargeId);

  const { data: studentRows } = useQuery<{ household_id: string | null }>(
    'SELECT household_id FROM students WHERE id = ?',
    [studentId]
  );
  const householdId = studentRows[0]?.household_id ?? null;

  const { data: siblingPayments } = useQuery<{
    household_transaction_id: string | null;
    amount_paid: number;
    first_name: string;
    last_name: string;
  }>(
    `SELECT p.household_transaction_id, p.amount_paid, s.first_name, s.last_name
     FROM payments p JOIN students s ON s.id = p.student_id
     WHERE s.household_id = ? AND p.student_id != ?`,
    [householdId ?? '', studentId]
  );

  const siblingByTxn = useMemo(() => {
    const map = new Map<string, { total: number; byChild: Map<string, number> }>();
    for (const p of siblingPayments) {
      if (!p.household_transaction_id) continue;
      const key = p.household_transaction_id;
      const name = `${p.last_name} ${p.first_name}`;
      const existing = map.get(key) ?? { total: 0, byChild: new Map<string, number>() };
      existing.total += p.amount_paid;
      existing.byChild.set(name, (existing.byChild.get(name) ?? 0) + p.amount_paid);
      map.set(key, existing);
    }
    return map;
  }, [siblingPayments]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof payments>();
    for (const p of payments) {
      const key = p.household_transaction_id ?? p.id;
      const existing = map.get(key);
      if (existing) existing.push(p);
      else map.set(key, [p]);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({
      key,
      rows,
      total: rows.reduce((sum, r) => sum + r.amount_paid, 0),
      date: rows[0].date_paid,
      method: rows[0].method,
      receiptNumber: rows[0].receipt_number
    }));
  }, [payments]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (groups.length === 0) {
    return <div className="empty-note">No payments recorded yet.</div>;
  }

  return (
    <div className="table-wrap">
      {groups.map((g) => {
        const siblingInfo = siblingByTxn.get(g.key);
        const singleRow = g.rows.length === 1 ? g.rows[0] : null;
        const singleRowIsVoid = !!singleRow?.void_of_payment_id;
        const singleRowIsVoided = !!singleRow && voidedOriginalIds.has(singleRow.id);
        const singleRowVoidable = !!singleRow && !singleRowIsVoid && !singleRowIsVoided && singleRow.amount_paid > 0;
        const firstCharge = chargeFor(g.rows[0].charge_id);

        return (
          <Fragment key={g.key}>
            <div className="payment-log-row">
              <div className="plog-date">{g.date}</div>
              <div className="plog-desc">
                <div className="f">
                  {g.rows.length > 1
                    ? `${g.rows.length} charges`
                    : (firstCharge?.feeItemName ?? 'Payment')}
                  {singleRowIsVoid && (
                    <span style={{ color: 'var(--rust)', fontWeight: 400 }} title={singleRow?.void_reason ?? ''}>
                      {' '}
                      (void)
                    </span>
                  )}
                  {singleRowIsVoided && <span style={{ color: 'var(--slate-soft)', fontWeight: 400 }}> (voided)</span>}
                </div>
                <div className="s">
                  {g.rows.length === 1 ? `${firstCharge?.sessionName ?? ''} ${firstCharge?.termName ?? ''}` : 'Split across charges'}
                </div>
              </div>
              <div className="plog-method">{METHOD_LABEL[g.method] ?? g.method}</div>
              <div className="plog-amt">+₦{g.total.toLocaleString()}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {g.rows.length > 1 && (
                  <span className="mini-btn" onClick={() => toggle(g.key)}>
                    {expanded.has(g.key) ? 'Hide' : 'Breakdown'}
                  </span>
                )}
                {singleRow && singleRowVoidable && (
                  <span
                    className="mini-btn"
                    style={{ color: 'var(--rust)', opacity: voiding === singleRow.id ? 0.5 : 1 }}
                    onClick={() => handleVoid(singleRow)}
                  >
                    {voiding === singleRow.id ? '…' : 'Void'}
                  </span>
                )}
                <Link className="mini-btn" to={`/receipt/${g.key}`} style={{ textDecoration: 'none' }}>
                  Receipt
                </Link>
              </div>
            </div>

            {g.rows.length > 1 && expanded.has(g.key) && (
              <div style={{ padding: '0 16px 10px 106px', background: 'var(--paper)' }}>
                {g.rows.map((r) => {
                  const c = chargeFor(r.charge_id);
                  const isVoid = !!r.void_of_payment_id;
                  const isVoided = voidedOriginalIds.has(r.id);
                  const voidable = !isVoid && !isVoided && r.amount_paid > 0;
                  return (
                    <div
                      key={r.id}
                      style={{ fontSize: 12, color: 'var(--slate)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <span style={{ flex: 1 }}>
                        {c ? `${c.feeItemName} — ${c.sessionName} ${c.termName}` : r.charge_id} — ₦
                        {r.amount_paid.toLocaleString()}
                        {isVoid && (
                          <span style={{ color: 'var(--rust)' }} title={r.void_reason ?? ''}>
                            {' '}
                            (void)
                          </span>
                        )}
                        {isVoided && <span style={{ color: 'var(--slate-soft)' }}> (voided)</span>}
                      </span>
                      {voidable && (
                        <span className="mini-btn" style={{ color: 'var(--rust)' }} onClick={() => handleVoid(r)}>
                          {voiding === r.id ? '…' : 'Void'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {siblingInfo && (
              <div style={{ padding: '0 16px 10px 106px', fontSize: 11.5, color: 'var(--gold)', background: 'var(--paper)' }}>
                Part of a ₦{(g.total + siblingInfo.total).toLocaleString()} household payment — also covers{' '}
                {Array.from(siblingInfo.byChild.entries())
                  .map(([name, amount]) => `${name} (₦${amount.toLocaleString()})`)
                  .join(', ')}
                . Full breakdown on the Household Payment page.
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
