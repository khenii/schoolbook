import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@powersync/react';
import { useSchoolLedger } from '../hooks/useSchoolLedger';

interface SchoolRow {
  name: string;
  address: string | null;
}

const methodLabel: Record<string, string> = {
  cash: 'Cash',
  'bank-transfer': 'Bank transfer',
  pos: 'POS',
  other: 'Other'
};

// A real, bookmarkable/printable route rather than the mockup's JS-only
// receipt modal — a deliberate deviation: receipts need to survive a page
// reload and be linkable from the payment log, the household reconciliation
// list, and a student's payment history, which a modal can't do. Visual
// language (brand block, mono receipt rows, print rules) still matches
// 07-payments.html's .receipt-modal as closely as a full page allows.
export default function ReceiptPage() {
  const { txnId } = useParams<{ txnId: string }>();
  const { payments, chargeBalances, studentMap, classLabel } = useSchoolLedger();
  const { data: schoolRows } = useQuery<SchoolRow>('SELECT name, address FROM schools LIMIT 1');
  const school = schoolRows[0];

  const chargeMap = useMemo(() => new Map(chargeBalances.map((c) => [c.id, c])), [chargeBalances]);

  const rows = useMemo(
    () => payments.filter((p) => (txnId ? p.household_transaction_id === txnId || p.id === txnId : false)),
    [payments, txnId]
  );

  const total = rows.reduce((sum, r) => sum + r.amount_paid, 0);
  const date = rows[0]?.date_paid;
  const method = rows[0]?.method;
  const receiptNumber = rows.find((r) => r.receipt_number)?.receipt_number ?? null;
  const hasVoid = rows.some((r) => r.void_of_payment_id);

  const byStudent = useMemo(() => {
    const map = new Map<string, { name: string; classLabel: string; rows: typeof rows }>();
    for (const r of rows) {
      const s = studentMap.get(r.student_id);
      const name = s ? `${s.first_name} ${s.last_name}` : 'Unknown student';
      const existing = map.get(r.student_id) ?? { name, classLabel: s ? classLabel(s.current_class_arm_id) : '', rows: [] };
      existing.rows.push(r);
      map.set(r.student_id, existing);
    }
    return Array.from(map.values());
  }, [rows, studentMap, classLabel]);

  if (!txnId || rows.length === 0) {
    return (
      <div className="receipt-page-empty">
        <p>
          <Link to="/payments">← Back to payments</Link>
        </p>
        <p className="muted">No payment found for this receipt.</p>
      </div>
    );
  }

  return (
    <div className="receipt-page">
      <div className="receipt-page-actions no-print">
        <Link to="/payments">← Back to payments</Link>
        <button className="btn-primary" onClick={() => window.print()}>
          Print receipt
        </button>
      </div>

      <div className="receipt-modal receipt-standalone" id="receiptPrintArea">
        <div className="receipt-brand">
          <h2>{school?.name ?? 'Schoolbook'}</h2>
          {school?.address && <p>{school.address}</p>}
        </div>
        <div className="receipt-title">Payment receipt</div>

        <div className="receipt-row">
          <span className="rl">Receipt No.</span>
          <span className="rv">{receiptNumber ?? '—'}</span>
        </div>
        <div className="receipt-row">
          <span className="rl">Date</span>
          <span className="rv">{date}</span>
        </div>
        <div className="receipt-row">
          <span className="rl">Method</span>
          <span className="rv">{methodLabel[method ?? ''] ?? method}</span>
        </div>

        {byStudent.map((student) => (
          <div className="receipt-student-block" key={student.name}>
            <div className="receipt-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 6 }}>
              <span className="rl" style={{ fontWeight: 700, color: 'var(--ink)' }}>
                {student.name} {student.classLabel ? `· ${student.classLabel}` : ''}
              </span>
              <span />
            </div>
            {student.rows.map((r) => {
              const charge = chargeMap.get(r.charge_id);
              return (
                <div className="receipt-row" key={r.id}>
                  <span className="rl">
                    {charge ? `${charge.feeItemName} — ${charge.sessionName} ${charge.termName}` : r.charge_id}
                    {r.void_of_payment_id && <span style={{ color: 'var(--rust)' }}> (VOID{r.void_reason ? `: ${r.void_reason}` : ''})</span>}
                  </span>
                  <span className="rv">₦{r.amount_paid.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        ))}

        <div className="receipt-amount">
          <div className="ra-label">Total received</div>
          <div className="ra-value">₦{total.toLocaleString()}</div>
        </div>

        {hasVoid && (
          <p className="receipt-void-note">
            This transaction includes a voided entry — the total above already reflects the reversal.
          </p>
        )}

        <div className="receipt-foot">Generated by Schoolbook — {new Date().toLocaleDateString()}</div>
      </div>
    </div>
  );
}
