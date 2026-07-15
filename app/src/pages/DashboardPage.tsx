import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useDashboardStats } from '../hooks/useDashboardStats';

function initials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '—'
  );
}

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
  const stats = useDashboardStats();

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <AppShell title="Dashboard" syncStatus={syncStatus}>
      <div className="greeting">
        <div className="eyebrow">{today}</div>
        <h2>{stats.schoolName ? `Good day, ${stats.schoolName}` : 'Dashboard'}</h2>
        <p>
          {stats.activeSession && stats.currentTerm
            ? `Here's where things stand for ${stats.currentTerm.name} of the ${stats.activeSession.name} session.`
            : 'No current term is set yet.'}
        </p>
      </div>

      {!stats.currentTerm && (
        <div
          className="stat-card"
          style={{ marginBottom: 20, borderColor: 'var(--gold)', background: '#FCF3E3' }}
        >
          <strong>No current term set.</strong> Dashboard stats need one term flagged as "current" school-wide.{' '}
          <Link to="/settings">Go to Settings → Sessions</Link> to add a session (or pick a current term if one
          already exists).
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Total students</div>
          <div className="value">{stats.totalStudents}</div>
          <div className="sub">
            Across {stats.levelsWithStudents} class level{stats.levelsWithStudents === 1 ? '' : 's'}
          </div>
        </div>
        <div className="stat-card success">
          <div className="label">Collected this term</div>
          <div className="value">₦{stats.collectedThisTerm.toLocaleString()}</div>
          <div className="sub">
            From {stats.collectedThisTermStudents} student{stats.collectedThisTermStudents === 1 ? '' : 's'}
          </div>
        </div>
        <div className="stat-card rust">
          <div className="label">Outstanding this term</div>
          <div className="value">₦{stats.outstandingThisTerm.toLocaleString()}</div>
          <div className="sub">
            {stats.outstandingThisTermStudents} student{stats.outstandingThisTermStudents === 1 ? '' : 's'} with a
            balance
          </div>
        </div>
        <div className="stat-card gold">
          <div className="label">Total arrears carried</div>
          <div className="value">₦{stats.totalArrears.toLocaleString()}</div>
          <div className="sub">
            From {stats.arrearsStudents} student{stats.arrearsStudents === 1 ? '' : 's'}, prior terms
          </div>
        </div>
      </div>

      <div className="quicklinks">
        <Link className="qlink" to="/students/new">
          <div className="qi">+</div>Add a student
        </Link>
        <Link className="qlink" to="/students">
          <div className="qi">☺</div>Search students
        </Link>
        <Link className="qlink" to="/household-payment">
          <div className="qi">₦</div>Record household payment
        </Link>
        <Link className="qlink" to="/settings?tab=fees">
          <div className="qi">₦</div>Edit fee items
        </Link>
        <Link className="qlink" to="/settings?tab=classes">
          <div className="qi">▤</div>Manage classes
        </Link>
      </div>

      <div className="grid-2">
        <div>
          <div className="panel-block">
            <div className="panel-block-head">
              <h3>Top defaulters</h3>
              <Link to="/reports">View full report →</Link>
            </div>
            {stats.topDefaulters.length === 0 ? (
              <div className="empty-note">No outstanding balances.</div>
            ) : (
              stats.topDefaulters.map((d) => (
                <Link key={d.studentId} to={`/students/${d.studentId}`} className="def-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="def-avatar">{initials(d.name)}</div>
                  <div className="def-name">
                    <div className="n">
                      {d.name}
                      {d.hasArrears && <span className="def-arrear-flag">ARREARS</span>}
                    </div>
                    <div className="c">{d.classLabel}</div>
                  </div>
                  <div className="def-amt">₦{d.amountOwed.toLocaleString()}</div>
                </Link>
              ))
            )}
          </div>

          <div className="panel-block">
            <div className="panel-block-head">
              <h3>Recent activity</h3>
            </div>
            {stats.recentActivity.length === 0 ? (
              <div className="empty-note">Nothing recorded yet.</div>
            ) : (
              stats.recentActivity.map((a) => (
                <div key={a.key} className="act-row">
                  <div className="act-dot" />
                  <div className="act-body">
                    <div className="m">{a.message}</div>
                    <div className="t">{timeAgoLabel(a.timestamp)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="panel-block">
            <div className="panel-block-head">
              <h3>Collection rate by class</h3>
            </div>
            {stats.classCollectionRates.length === 0 ? (
              <div className="empty-note">No charges for the current term yet.</div>
            ) : (
              stats.classCollectionRates.map((c) => (
                <div key={c.classLevelId} className="class-row">
                  <div className="lvl">{c.name}</div>
                  <div className="bar-wrap">
                    <div className="bar" style={{ width: `${c.pct ?? 0}%` }} />
                  </div>
                  <div className="pct">{c.pct ?? '—'}%</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
