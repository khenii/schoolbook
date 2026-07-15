import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { useStudentLedger } from '../../hooks/useStudentLedger';
import { logAudit } from '../../lib/auditLog';

type PaymentRow = ReturnType<typeof useStudentLedger>['payments'][number];

export default function PaymentHistorySection({ studentId }: { studentId: string }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const { payments, charges } = useStudentLedger(studentId);

  // A payment row can be voided at most once — reversals target the
  // original payment's id via void_of_payment_id, never edit or delete it
  // (payments has no UPDATE/DELETE policy at all). This tracks which
  // originals already have a reversal, so the action doesn't offer to
  // double-void something.
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

  const chargeLabel = (chargeId: string) => {
    const c = charges.find((x) => x.id === chargeId);
    return c ? `${c.feeItemName} — ${c.sessionName} ${c.termName}` : chargeId;
  };

  // A payment recorded from the Household Payment page can cover this
  // student AND siblings in one go (spec §3.6). This student's own rows
  // above only show their own slice — cross-reference siblings sharing the
  // same household_transaction_id so it's clear, from this page alone,
  // that the full amount received was bigger and where the rest went.
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

  // Payments recorded in one go (e.g. a single ₦30,000 cash receipt split
  // across School Fees + Uniform) share a transaction id. Group them back
  // together for display so this screen shows one line per amount actually
  // received — matching what a receipt book or bank statement would show —
  // with the per-charge breakdown available on expand rather than scattered
  // across separate rows.
  const groups = useMemo(() => {
    const map = new Map<string, typeof payments>();
    for (const p of payments) {
      const key = p.household_transaction_id ?? p.id;
      const existing = map.get(key);
      if (existing) {
        existing.push(p);
      } else {
        map.set(key, [p]);
      }
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

  return (
    <div style={{ margin: '1.5rem 0' }}>
      <h2>Payment history</h2>
      {groups.length === 0 ? (
        <p style={{ color: '#888', fontSize: 12.5 }}>No payments recorded yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12 }}>
              <th style={{ padding: 6 }}>Date</th>
              <th style={{ padding: 6 }}>Amount received</th>
              <th style={{ padding: 6 }}>Method</th>
              <th style={{ padding: 6 }}>Receipt #</th>
              <th style={{ padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const siblingInfo = siblingByTxn.get(g.key);
              const singleRow = g.rows.length === 1 ? g.rows[0] : null;
              const singleRowIsVoid = !!singleRow?.void_of_payment_id;
              const singleRowIsVoided = !!singleRow && voidedOriginalIds.has(singleRow.id);
              const singleRowVoidable = !!singleRow && !singleRowIsVoid && !singleRowIsVoided && singleRow.amount_paid > 0;
              return (
              <Fragment key={g.key}>
                <tr style={{ borderBottom: siblingInfo ? 'none' : '1px solid #eee', fontSize: 13 }}>
                  <td style={{ padding: 6 }}>{g.date}</td>
                  <td style={{ padding: 6, fontWeight: 600 }}>
                    ₦{g.total.toLocaleString()}
                    {g.rows.length > 1 && (
                      <span style={{ color: '#888', fontWeight: 400 }}> ({g.rows.length} charges)</span>
                    )}
                    {singleRowIsVoid && (
                      <span style={{ color: 'crimson', fontWeight: 400 }} title={singleRow?.void_reason ?? ''}>
                        {' '}
                        (void)
                      </span>
                    )}
                    {singleRowIsVoided && <span style={{ color: '#888', fontWeight: 400 }}> (voided)</span>}
                  </td>
                  <td style={{ padding: 6 }}>{g.method}</td>
                  <td style={{ padding: 6 }}>{g.receiptNumber ?? '—'}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    {g.rows.length > 1 && (
                      <button onClick={() => toggle(g.key)} style={{ fontSize: 11 }}>
                        {expanded.has(g.key) ? 'Hide breakdown' : 'Show breakdown'}
                      </button>
                    )}
                    {singleRow && singleRowVoidable && (
                      <button onClick={() => handleVoid(singleRow)} disabled={voiding === singleRow.id} style={{ fontSize: 11 }}>
                        {voiding === singleRow.id ? '…' : 'Void'}
                      </button>
                    )}{' '}
                    <Link to={`/receipt/${g.key}`} style={{ fontSize: 11 }}>
                      Receipt
                    </Link>
                  </td>
                </tr>
                {g.rows.length > 1 && expanded.has(g.key) && (
                  <tr>
                    <td colSpan={5} style={{ padding: '0 6px 8px 24px' }}>
                      {g.rows.map((r) => {
                        const isVoid = !!r.void_of_payment_id;
                        const isVoided = voidedOriginalIds.has(r.id);
                        const voidable = !isVoid && !isVoided && r.amount_paid > 0;
                        return (
                          <div
                            key={r.id}
                            style={{
                              fontSize: 12,
                              color: '#555',
                              padding: '2px 0',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8
                            }}
                          >
                            <span style={{ flex: 1 }}>
                              {chargeLabel(r.charge_id)} — ₦{r.amount_paid.toLocaleString()}
                              {isVoid && (
                                <span style={{ color: 'crimson' }} title={r.void_reason ?? ''}>
                                  {' '}
                                  (void)
                                </span>
                              )}
                              {isVoided && <span style={{ color: '#888' }}> (voided)</span>}
                            </span>
                            {voidable && (
                              <button onClick={() => handleVoid(r)} disabled={voiding === r.id} style={{ fontSize: 10.5 }}>
                                {voiding === r.id ? '…' : 'Void'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                )}
                {siblingInfo && (
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td colSpan={5} style={{ padding: '0 6px 8px 6px', fontSize: 11.5, color: '#b8860b' }}>
                      Part of a ₦{(g.total + siblingInfo.total).toLocaleString()} household payment — also covers{' '}
                      {Array.from(siblingInfo.byChild.entries())
                        .map(([name, amount]) => `${name} (₦${amount.toLocaleString()})`)
                        .join(', ')}
                      . Full breakdown on the Household Payment page.
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
