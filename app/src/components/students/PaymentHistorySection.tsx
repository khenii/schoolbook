import { Fragment, useMemo, useState } from 'react';
import { useStudentLedger } from '../../hooks/useStudentLedger';

export default function PaymentHistorySection({ studentId }: { studentId: string }) {
  const { payments, charges } = useStudentLedger(studentId);

  const chargeLabel = (chargeId: string) => {
    const c = charges.find((x) => x.id === chargeId);
    return c ? `${c.feeItemName} — ${c.sessionName} ${c.termName}` : chargeId;
  };

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
            {groups.map((g) => (
              <Fragment key={g.key}>
                <tr style={{ borderBottom: '1px solid #eee', fontSize: 13 }}>
                  <td style={{ padding: 6 }}>{g.date}</td>
                  <td style={{ padding: 6, fontWeight: 600 }}>
                    ₦{g.total.toLocaleString()}
                    {g.rows.length > 1 && (
                      <span style={{ color: '#888', fontWeight: 400 }}> ({g.rows.length} charges)</span>
                    )}
                  </td>
                  <td style={{ padding: 6 }}>{g.method}</td>
                  <td style={{ padding: 6 }}>{g.receiptNumber ?? '—'}</td>
                  <td style={{ padding: 6 }}>
                    {g.rows.length > 1 && (
                      <button onClick={() => toggle(g.key)} style={{ fontSize: 11 }}>
                        {expanded.has(g.key) ? 'Hide breakdown' : 'Show breakdown'}
                      </button>
                    )}
                  </td>
                </tr>
                {g.rows.length > 1 && expanded.has(g.key) && (
                  <tr>
                    <td colSpan={5} style={{ padding: '0 6px 8px 24px' }}>
                      {g.rows.map((r) => (
                        <div key={r.id} style={{ fontSize: 12, color: '#555', padding: '2px 0' }}>
                          {chargeLabel(r.charge_id)} — ₦{r.amount_paid.toLocaleString()}
                          {r.void_of_payment_id && <span style={{ color: 'crimson' }}> (void)</span>}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
