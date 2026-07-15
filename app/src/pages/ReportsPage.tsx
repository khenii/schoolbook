import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useReportsData } from '../hooks/useReportsData';
import { exportToCSV } from '../lib/csv';

type Tab = 'defaulters' | 'arrears' | 'collections';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// School-wide "Reports" — Defaulters / Arrears / Collections summary tabs,
// matching 08-reports.html. All the underlying numbers already came from
// useReportsData (built earlier from the same charge-balance source the
// dashboard uses); this task is purely visual.
export default function ReportsPage() {
  const { currentTerm, levels, defaulters, defaulterStats, arrears, arrearsStats, collections, collectionsStats } =
    useReportsData();
  const [tab, setTab] = useState<Tab>('defaulters');

  const [defLevel, setDefLevel] = useState('all');
  const [defSort, setDefSort] = useState<'desc' | 'asc'>('desc');
  const [arrLevel, setArrLevel] = useState('all');

  const filteredDefaulters = useMemo(() => {
    let list = defaulters.filter((d) => defLevel === 'all' || d.classLevelName === defLevel);
    list = [...list].sort((a, b) => (defSort === 'desc' ? b.amountOwed - a.amountOwed : a.amountOwed - b.amountOwed));
    return list;
  }, [defaulters, defLevel, defSort]);

  const filteredArrears = useMemo(
    () => arrears.filter((a) => arrLevel === 'all' || a.currentClassLevelName === arrLevel),
    [arrears, arrLevel]
  );

  function handleExportDefaulters() {
    exportToCSV(
      `defaulters-${defLevel === 'all' ? 'all-classes' : defLevel}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Student', 'Class', 'Balance Owed', 'Has Prior Arrears'],
      filteredDefaulters.map((d) => [d.name, d.classLabel, d.amountOwed, d.hasArrears ? 'Yes' : 'No'])
    );
  }

  function handleExportArrears() {
    exportToCSV(
      `arrears-${arrLevel === 'all' ? 'all-classes' : arrLevel}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Student', 'Current Class', 'Arrears From Class', 'Arrears From Term', 'Amount Owed'],
      filteredArrears.map((a) => [a.name, a.currentClassLabel, a.fromClassLevelName, a.fromTermLabel, a.amountOwed])
    );
  }

  function handleExportCollections() {
    exportToCSV(
      `collections-summary-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Class', 'Expected', 'Collected', 'Outstanding', 'Collection Rate %'],
      collections.map((c) => [c.name, c.expected, c.collected, c.outstanding, c.pct ?? ''])
    );
  }

  return (
    <AppShell title="Reports" pageClass="page-reports">
      <div className="page-head">
        <div className="eyebrow">Records</div>
        <h2>School-wide reports</h2>
        <p>
          Who owes what, where old debt is still sitting, and how collections are trending by class.
          {currentTerm ? ` Current term: ${currentTerm.name}.` : ' No current term is set — see Settings → Sessions.'}
        </p>
      </div>

      <div className="tabs">
        <div className={`tab${tab === 'defaulters' ? ' active' : ''}`} onClick={() => setTab('defaulters')}>
          Defaulters
        </div>
        <div className={`tab${tab === 'arrears' ? ' active' : ''}`} onClick={() => setTab('arrears')}>
          Arrears
        </div>
        <div className={`tab${tab === 'collections' ? ' active' : ''}`} onClick={() => setTab('collections')}>
          Collections summary
        </div>
      </div>

      {tab === 'defaulters' && (
        <div className="view active">
          <div className="stat-row">
            <div className="stat-card rust">
              <div className="label">Total outstanding</div>
              <div className="value">₦{defaulterStats.totalOutstanding.toLocaleString()}</div>
              <div className="sub">
                {defaulters.length} student{defaulters.length === 1 ? '' : 's'} with a current-term balance
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Average balance</div>
              <div className="value">₦{Math.round(defaulterStats.avgBalance).toLocaleString()}</div>
              <div className="sub">per defaulting student</div>
            </div>
            <div className="stat-card gold">
              <div className="label">Also carrying arrears</div>
              <div className="value">{defaulterStats.alsoCarryingArrears}</div>
              <div className="sub">of these students owe from prior sessions too</div>
            </div>
          </div>

          <div className="filter-bar">
            <div className="filter-left">
              <select value={defLevel} onChange={(e) => setDefLevel(e.target.value)}>
                <option value="all">All classes</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
              <select value={defSort} onChange={(e) => setDefSort(e.target.value as 'desc' | 'asc')}>
                <option value="desc">Highest balance first</option>
                <option value="asc">Lowest balance first</option>
              </select>
            </div>
            <button className="btn-ghost" onClick={handleExportDefaulters} disabled={filteredDefaulters.length === 0}>
              Export list
            </button>
          </div>

          <div className="table-wrap">
            <div className="t-row head">
              <div className="col-avatar" />
              <div className="col-student">Student</div>
              <div className="col-source">Class</div>
              <div className="col-amt">Balance owed</div>
              <div className="col-action" />
            </div>
            {filteredDefaulters.length === 0 ? (
              <div className="empty-note">No defaulters in this view.</div>
            ) : (
              filteredDefaulters.map((d) => (
                <div className="t-row" key={d.studentId}>
                  <div className="col-avatar">
                    <div className="avatar">{initials(d.name)}</div>
                  </div>
                  <div className="col-student">
                    <div className="n">
                      {d.name}
                      {d.hasArrears && <span className="flag">ARREARS</span>}
                    </div>
                  </div>
                  <div className="col-source">
                    <div className="t">{d.classLabel}</div>
                  </div>
                  <div className="col-amt rust">₦{d.amountOwed.toLocaleString()}</div>
                  <div className="col-action">
                    <Link className="view-link" to={`/students/${d.studentId}`}>
                      View →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'arrears' && (
        <div className="view active">
          <div className="stat-row">
            <div className="stat-card gold">
              <div className="label">Total arrears carried</div>
              <div className="value">₦{arrearsStats.totalArrears.toLocaleString()}</div>
              <div className="sub">
                across {arrearsStats.studentCount} student{arrearsStats.studentCount === 1 ? '' : 's'}, from prior
                sessions
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Oldest unresolved</div>
              <div className="value" style={{ fontSize: 18 }}>
                {arrearsStats.oldestUnresolvedLabel ?? '—'}
              </div>
              <div className="sub">still unpaid</div>
            </div>
          </div>

          <div className="filter-bar">
            <div className="filter-left">
              <select value={arrLevel} onChange={(e) => setArrLevel(e.target.value)}>
                <option value="all">All current classes</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-ghost" onClick={handleExportArrears} disabled={filteredArrears.length === 0}>
              Export list
            </button>
          </div>

          <div className="table-wrap">
            <div className="t-row head">
              <div className="col-avatar" />
              <div className="col-student">Student (now)</div>
              <div className="col-source">Arrears from</div>
              <div className="col-amt">Amount owed</div>
              <div className="col-action" />
            </div>
            {filteredArrears.length === 0 ? (
              <div className="empty-note">No arrears in this view.</div>
            ) : (
              filteredArrears.map((a) => (
                <div className="t-row" key={a.key}>
                  <div className="col-avatar">
                    <div className="avatar">{initials(a.name)}</div>
                  </div>
                  <div className="col-student">
                    <div className="n">{a.name}</div>
                    <div className="c">{a.currentClassLabel}</div>
                  </div>
                  <div className="col-source">
                    <div className="t">{a.fromClassLevelName}</div>
                    <div className="s">{a.fromTermLabel}</div>
                  </div>
                  <div className="col-amt gold">₦{a.amountOwed.toLocaleString()}</div>
                  <div className="col-action">
                    <Link className="view-link" to={`/students/${a.studentId}`}>
                      View →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'collections' && (
        <div className="view active">
          <div className="stat-row">
            <div className="stat-card">
              <div className="label">Expected this term</div>
              <div className="value">₦{collectionsStats.expected.toLocaleString()}</div>
              <div className="sub">across all class levels</div>
            </div>
            <div className="stat-card">
              <div className="label">Collected so far</div>
              <div className="value">₦{collectionsStats.collected.toLocaleString()}</div>
              <div className="sub">{collectionsStats.collectedPct ?? 0}% of expected</div>
            </div>
            <div className="stat-card rust">
              <div className="label">Remaining</div>
              <div className="value">₦{collectionsStats.remaining.toLocaleString()}</div>
              <div className="sub">
                {collectionsStats.collectedPct !== null ? 100 - collectionsStats.collectedPct : 0}% still outstanding
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn-ghost" onClick={handleExportCollections} disabled={collections.length === 0}>
              Export list
            </button>
          </div>

          <div className="table-wrap">
            <div className="t-row head" style={{ padding: '9px 16px' }}>
              <div style={{ flex: 1.1 }}>Class</div>
              <div style={{ flex: 2 }}>Collection rate</div>
              <div style={{ width: 110, textAlign: 'right' }}>Outstanding</div>
            </div>
            {collections.length === 0 ? (
              <div className="empty-note">No charges for the current term yet.</div>
            ) : (
              collections.map((c) => (
                <div className="class-row" key={c.classLevelId}>
                  <div className="lvl">{c.name}</div>
                  <div className="bar-wrap">
                    <div className="bar" style={{ width: `${c.pct ?? 0}%` }} />
                  </div>
                  <div className="pct">{c.pct ?? '—'}%</div>
                  <div className="amt">₦{c.outstanding.toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
