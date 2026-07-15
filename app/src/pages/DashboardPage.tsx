import { Link } from 'react-router-dom';
import { useAppContext } from '../lib/AppContext';
import { supabase } from '../lib/supabase';
import { useDashboardStats } from '../hooks/useDashboardStats';

const cardStyle: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '16px 18px'
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#64748b',
  marginBottom: 6
};

const panelStyle: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  overflow: 'hidden',
  marginBottom: 20
};

const panelHeadStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e2e8f0',
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
};

function timeAgoLabel(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

export default function DashboardPage({ syncStatus }: { syncStatus: string }) {
  const { session } = useAppContext();
  const stats = useDashboardStats();

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>{session.user.email}</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 13 }}>
          <Link to="/students">Students</Link>
          <Link to="/class-register">Class Register</Link>
          <Link to="/household-payment">Household Payment</Link>
          <Link to="/reports">Reports</Link>
          <Link to="/settings">Settings</Link>
          <span style={{ color: '#64748b' }}>Sync: {syncStatus}</span>
          <button onClick={() => supabase.auth.signOut()}>Log out</button>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b' }}>
          {today}
        </div>
        <h1 style={{ margin: '4px 0 2px' }}>
          {stats.schoolName ? `Good day, ${stats.schoolName}` : 'Dashboard'}
        </h1>
        <p style={{ color: '#64748b', margin: 0 }}>
          {stats.activeSession && stats.currentTerm
            ? `Here's where things stand for ${stats.currentTerm.name} of the ${stats.activeSession.name} session.`
            : 'No current term is set yet.'}
        </p>
      </div>

      {!stats.currentTerm && (
        <div
          style={{
            ...cardStyle,
            marginBottom: 20,
            borderColor: '#b8860b',
            background: '#fdf6e8'
          }}
        >
          <strong>No current term set.</strong> Dashboard stats need one term flagged as "current" school-wide.{' '}
          <Link to="/settings">Go to Settings → Sessions</Link> to add a session (or pick a current term if one
          already exists).
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
          marginBottom: 24
        }}
      >
        <div style={cardStyle}>
          <div style={labelStyle}>Total students</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.totalStudents}</div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
            Across {stats.levelsWithStudents} class level{stats.levelsWithStudents === 1 ? '' : 's'}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Collected this term</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#3A7D5C' }}>
            ₦{stats.collectedThisTerm.toLocaleString()}
          </div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
            From {stats.collectedThisTermStudents} student{stats.collectedThisTermStudents === 1 ? '' : 's'}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Outstanding this term</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#B84C3E' }}>
            ₦{stats.outstandingThisTerm.toLocaleString()}
          </div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
            {stats.outstandingThisTermStudents} student{stats.outstandingThisTermStudents === 1 ? '' : 's'} with a
            balance
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Total arrears carried</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#b8860b' }}>₦{stats.totalArrears.toLocaleString()}</div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
            From {stats.arrearsStudents} student{stats.arrearsStudents === 1 ? '' : 's'}, prior terms
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        <Link to="/students/new" style={{ flex: '1 1 180px' }}>
          <div style={{ ...cardStyle, padding: '12px 14px', fontWeight: 600 }}>+ Add a student</div>
        </Link>
        <Link to="/students" style={{ flex: '1 1 180px' }}>
          <div style={{ ...cardStyle, padding: '12px 14px', fontWeight: 600 }}>Search students</div>
        </Link>
        <Link to="/household-payment" style={{ flex: '1 1 180px' }}>
          <div style={{ ...cardStyle, padding: '12px 14px', fontWeight: 600 }}>Record household payment</div>
        </Link>
        <Link to="/settings?tab=fees" style={{ flex: '1 1 180px' }}>
          <div style={{ ...cardStyle, padding: '12px 14px', fontWeight: 600 }}>Edit fee items</div>
        </Link>
        <Link to="/settings?tab=classes" style={{ flex: '1 1 180px' }}>
          <div style={{ ...cardStyle, padding: '12px 14px', fontWeight: 600 }}>Manage classes</div>
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, alignItems: 'start' }}>
        <div>
          <div style={panelStyle}>
            <div style={panelHeadStyle}>
              <span>Top defaulters</span>
              <Link to="/reports" style={{ fontSize: 12, fontWeight: 600 }}>
                View full report →
              </Link>
            </div>
            {stats.topDefaulters.length === 0 ? (
              <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>No outstanding balances. 🎉</div>
            ) : (
              stats.topDefaulters.map((d) => (
                <Link
                  key={d.studentId}
                  to={`/students/${d.studentId}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 16px',
                    borderBottom: '1px solid #eee',
                    fontSize: 13,
                    color: 'inherit'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>
                      {d.name}
                      {d.hasArrears && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            color: '#b8860b',
                            background: '#fdf1da',
                            padding: '2px 6px',
                            borderRadius: 5,
                            marginLeft: 6
                          }}
                        >
                          ARREARS
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{d.classLabel}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: '#B84C3E' }}>₦{d.amountOwed.toLocaleString()}</div>
                </Link>
              ))
            )}
          </div>

          <div style={panelStyle}>
            <div style={panelHeadStyle}>Recent activity</div>
            {stats.recentActivity.length === 0 ? (
              <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>Nothing recorded yet.</div>
            ) : (
              stats.recentActivity.map((a) => (
                <div
                  key={a.key}
                  style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid #eee',
                    fontSize: 13
                  }}
                >
                  <div>{a.message}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{timeAgoLabel(a.timestamp)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={panelStyle}>
          <div style={panelHeadStyle}>Collection rate by class — this term</div>
          {stats.classCollectionRates.length === 0 ? (
            <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>No charges for the current term yet.</div>
          ) : (
            stats.classCollectionRates.map((c) => (
              <div
                key={c.classLevelId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 16px',
                  borderBottom: '1px solid #eee',
                  fontSize: 12.5
                }}
              >
                <div style={{ flex: 1, fontWeight: 600 }}>{c.name}</div>
                <div style={{ flex: 1.4, height: 6, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${c.pct ?? 0}%`,
                      background: '#3A7D5C',
                      borderRadius: 4
                    }}
                  />
                </div>
                <div style={{ width: 38, textAlign: 'right', color: '#64748b' }}>{c.pct ?? '—'}%</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
