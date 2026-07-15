import { useStudentLedger } from '../../hooks/useStudentLedger';

export default function ProfileSummary({ studentId }: { studentId: string }) {
  const { currentTermBalance, arrears, totalArrears, totalOutstanding } = useStudentLedger(studentId);

  return (
    <div style={{ margin: '1.5rem 0' }}>
      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Current term balance</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: currentTermBalance > 0 ? 'crimson' : 'inherit' }}>
            ₦{currentTermBalance.toLocaleString()}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Arrears (past terms)</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: totalArrears > 0 ? 'crimson' : 'inherit' }}>
            ₦{totalArrears.toLocaleString()}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Total outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: totalOutstanding > 0 ? 'crimson' : 'inherit' }}>
            ₦{totalOutstanding.toLocaleString()}
          </div>
        </div>
      </div>

      {arrears.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
            Arrears breakdown — oldest first, excludes the current term
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12 }}>
                <th style={{ padding: 6 }}>Session</th>
                <th style={{ padding: 6 }}>Term</th>
                <th style={{ padding: 6 }}>Fee item</th>
                <th style={{ padding: 6 }}>Owed</th>
              </tr>
            </thead>
            <tbody>
              {arrears.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #eee', fontSize: 13 }}>
                  <td style={{ padding: 6 }}>{c.sessionName}</td>
                  <td style={{ padding: 6 }}>{c.termName}</td>
                  <td style={{ padding: 6 }}>{c.feeItemName}</td>
                  <td style={{ padding: 6, color: 'crimson' }}>₦{c.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
