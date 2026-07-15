import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReportsData } from '../hooks/useReportsData';
import { exportToCSV } from '../lib/csv';

type Tab = 'defaulters' | 'arrears' | 'collections';

const cardStyle: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '14px 16px',
  flex: 1
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#64748b',
  marginBottom: 6
};

const tableWrapStyle: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  overflow: 'hidden'
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  borderBottom: '1px solid #eee',
  fontSize: 12.5
};

const headRowStyle: React.CSSProperties = {
  ...rowStyle,
  background: '#f8fafc',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#64748b',
  fontWeight: 600
};

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
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
      <h1 style={{ marginBottom: 2 }}>Reports</h1>
      <p style={{ color: '#64748b', margin: 0 }}>
        Who owes what, where old debt is still sitting, and how collections are trending by class.
        {currentTerm ? ` Current term: ${currentTerm.name}.` : ' No current term is set — see Settings → Sessions.'}
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '1.25rem 0 1.25rem' }}>
        <button onClick={() => setTab('defaulters')} disabled={tab === 'defaulters'}>
          Defaulters
        </button>
        <button onClick={() => setTab('arrears')} disabled={tab === 'arrears'}>
          Arrears
        </button>
        <button onClick={() => setTab('collections')} disabled={tab === 'collections'}>
          Collections summary
        </button>
      </div>

      {tab === 'defaulters' && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={labelStyle}>Total outstanding</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#B84C3E' }}>
                ₦{defaulterStats.totalOutstanding.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                {defaulters.length} student{defaulters.length === 1 ? '' : 's'} with a current-term balance
              </div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Average balance</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                ₦{Math.round(defaulterStats.avgBalance).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>per defaulting student</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Also carrying arrears</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#b8860b' }}>
                {defaulterStats.alsoCarryingArrears}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>owe from prior terms too</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
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
            <button onClick={handleExportDefaulters}>Export list</button>
          </div>

          <div style={tableWrapStyle}>
            <div style={headRowStyle}>
              <div style={{ flex: 1.6 }}>Student</div>
              <div style={{ flex: 1 }}>Class</div>
              <div style={{ flex: 1, textAlign: 'right' }}>Balance owed</div>
              <div style={{ flex: 0.6, textAlign: 'right' }} />
            </div>
            {filteredDefaulters.length === 0 ? (
              <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>No defaulters in this view.</div>
            ) : (
              filteredDefaulters.map((d) => (
                <div key={d.studentId} style={rowStyle}>
                  <div style={{ flex: 1.6 }}>
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
                  </div>
                  <div style={{ flex: 1 }}>{d.classLabel}</div>
                  <div style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: '#B84C3E' }}>
                    ₦{d.amountOwed.toLocaleString()}
                  </div>
                  <div style={{ flex: 0.6, textAlign: 'right' }}>
                    <Link to={`/students/${d.studentId}`} style={{ fontSize: 11.5 }}>
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
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={labelStyle}>Total arrears carried</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#b8860b' }}>
                ₦{arrearsStats.totalArrears.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                across {arrearsStats.studentCount} student{arrearsStats.studentCount === 1 ? '' : 's'}, prior terms
              </div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Oldest unresolved</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{arrearsStats.oldestUnresolvedLabel ?? '—'}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>still unpaid</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <select value={arrLevel} onChange={(e) => setArrLevel(e.target.value)}>
              <option value="all">All current classes</option>
              {levels.map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
            <button onClick={handleExportArrears}>Export list</button>
          </div>

          <div style={tableWrapStyle}>
            <div style={headRowStyle}>
              <div style={{ flex: 1.6 }}>Student (now)</div>
              <div style={{ flex: 1.4 }}>Arrears from</div>
              <div style={{ flex: 1, textAlign: 'right' }}>Amount owed</div>
              <div style={{ flex: 0.6, textAlign: 'right' }} />
            </div>
            {filteredArrears.length === 0 ? (
              <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>No arrears in this view.</div>
            ) : (
              filteredArrears.map((a) => (
                <div key={a.key} style={rowStyle}>
                  <div style={{ flex: 1.6 }}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{a.currentClassLabel}</div>
                  </div>
                  <div style={{ flex: 1.4 }}>
                    <div>{a.fromClassLevelName}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{a.fromTermLabel}</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: '#b8860b' }}>
                    ₦{a.amountOwed.toLocaleString()}
                  </div>
                  <div style={{ flex: 0.6, textAlign: 'right' }}>
                    <Link to={`/students/${a.studentId}`} style={{ fontSize: 11.5 }}>
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
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={labelStyle}>Expected this term</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>₦{collectionsStats.expected.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>across all class levels</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Collected so far</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#3A7D5C' }}>
                ₦{collectionsStats.collected.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                {collectionsStats.collectedPct ?? 0}% of expected
              </div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Remaining</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#B84C3E' }}>
                ₦{collectionsStats.remaining.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                {collectionsStats.collectedPct !== null ? 100 - collectionsStats.collectedPct : 0}% still outstanding
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={handleExportCollections} disabled={collections.length === 0}>
              Export list
            </button>
          </div>

          <div style={tableWrapStyle}>
            <div style={headRowStyle}>
              <div style={{ flex: 1.1 }}>Class</div>
              <div style={{ flex: 2 }}>Collection rate</div>
              <div style={{ width: 110, textAlign: 'right' }}>Outstanding</div>
            </div>
            {collections.length === 0 ? (
              <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>No charges for the current term yet.</div>
            ) : (
              collections.map((c) => (
                <div key={c.classLevelId} style={rowStyle}>
                  <div style={{ flex: 1.1, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 7, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${c.pct ?? 0}%`,
                          background: '#3A7D5C',
                          borderRadius: 4
                        }}
                      />
                    </div>
                    <div style={{ width: 34, textAlign: 'right', color: '#64748b', fontSize: 11 }}>
                      {c.pct ?? '—'}%
                    </div>
                  </div>
                  <div style={{ width: 110, textAlign: 'right', color: '#334155' }}>
                    ₦{c.outstanding.toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
