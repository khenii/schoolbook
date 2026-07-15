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

export default function ReceiptPage() {
  const { txnId } = useParams<{ txnId: string }>();
  const { payments, chargeBalances, studentMap } = useSchoolLedger();
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
    const map = new Map<string, { name: string; rows: typeof rows }>();
    for (const r of rows) {
      const s = studentMap.get(r.student_id);
      const name = s ? `${s.last_name} ${s.first_name}` : 'Unknown student';
      const existing = map.get(r.student_id) ?? { name, rows: [] };
      existing.rows.push(r);
      map.set(r.student_id, existing);
    }
    return Array.from(map.values());
  }, [rows, studentMap]);

  if (!txnId || rows.length === 0) {
    return (
      <div style={{ maxWidth: 500, margin: '3rem auto', padding: '0 1rem' }}>
        <p>
          <Link to="/">← Back to dashboard</Link>
        </p>
        <p style={{ color: '#888' }}>No payment found for this receipt.</p>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 600, margin: '1.5rem auto 0', padding: '0 1rem' }}>
        <p>
          <Link to="/">← Back to dashboard</Link>
        </p>
        <button onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div
        style={{
          maxWidth: 600,
          margin: '1.5rem auto 3rem',
          padding: '2rem',
          border: '1px solid #ddd',
          fontFamily: 'Georgia, serif',
          color: '#16233D'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{school?.name ?? 'Receipt'}</h1>
          {school?.address && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#555' }}>{school.address}</p>}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '16px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 16 }}>
          <div>
            <div>
              <strong>Receipt #:</strong> {receiptNumber ?? '—'}
            </div>
            <div>
              <strong>Date:</strong> {date}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              <strong>Method:</strong> {methodLabel[method ?? ''] ?? method}
            </div>
          </div>
        </div>

        {byStudent.map((student) => (
          <div key={student.name} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{student.name}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {student.rows.map((r) => {
                  const charge = chargeMap.get(r.charge_id);
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '4px 0' }}>
                        {charge ? `${charge.feeItemName} — ${charge.sessionName} ${charge.termName}` : r.charge_id}
                        {r.void_of_payment_id && <span style={{ color: 'crimson' }}> (VOID{r.void_reason ? `: ${r.void_reason}` : ''})</span>}
                      </td>
                      <td style={{ padding: '4px 0', textAlign: 'right' }}>₦{r.amount_paid.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        <hr style={{ border: 'none', borderTop: '2px solid #16233D', margin: '16px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700 }}>
          <span>Total</span>
          <span>₦{total.toLocaleString()}</span>
        </div>

        {hasVoid && (
          <p style={{ fontSize: 11.5, color: 'crimson', marginTop: 12 }}>
            This transaction includes a voided entry — the total above already reflects the reversal.
          </p>
        )}

        <p style={{ fontSize: 11, color: '#888', marginTop: 24, textAlign: 'center' }}>
          Generated by Schoolbook — {new Date().toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
