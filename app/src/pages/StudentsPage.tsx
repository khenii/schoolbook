import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@powersync/react';
import AppShell from '../components/AppShell';
import AddStudentPanel from '../components/students/AddStudentPanel';
import { exportToCSV } from '../lib/csv';
import { normalizePhone } from '../lib/households';

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  status: string;
  current_class_arm_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
}

interface ClassArmRow {
  id: string;
  class_level_id: string;
  name: string;
}

interface ClassLevelRow {
  id: string;
  name: string;
}

const PAGE_SIZE = 15;

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '—';
}

// Compact page-number window (current ± 2), same rule as 04-students.html —
// avoids rendering a button per page even at a few hundred students.
function paginationWindow(current: number, total: number): (number | '…')[] {
  const pages: (number | '…')[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - current) <= 2) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return pages;
}

export default function StudentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: students } = useQuery<StudentRow>('SELECT * FROM students ORDER BY last_name ASC, first_name ASC');
  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name FROM class_levels ORDER BY sort_order ASC');

  const armById = useMemo(() => new Map(arms.map((a) => [a.id, a])), [arms]);
  const levelById = useMemo(() => new Map(levels.map((l) => [l.id, l])), [levels]);
  const armNamesByLevel = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of arms) {
      const list = map.get(a.class_level_id) ?? [];
      if (!list.includes(a.name)) list.push(a.name);
      map.set(a.class_level_id, list.sort());
    }
    return map;
  }, [arms]);

  const classLabel = (armId: string | null) => {
    if (!armId) return '—';
    const arm = armById.get(armId);
    if (!arm) return '—';
    return `${levelById.get(arm.class_level_id)?.name ?? ''} ${arm.name}`.trim();
  };

  const [filterLevel, setFilterLevel] = useState('all');
  const [filterArm, setFilterArm] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const [panelOpen, setPanelOpen] = useState(searchParams.get('add') === '1');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const inactiveCount = students.filter((s) => s.status === 'withdrawn' || s.status === 'graduated').length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = normalizePhone(search);
    return students.filter((s) => {
      if (!showInactive && (s.status === 'withdrawn' || s.status === 'graduated')) return false;
      const arm = s.current_class_arm_id ? armById.get(s.current_class_arm_id) : null;
      if (filterLevel !== 'all' && arm?.class_level_id !== filterLevel) return false;
      if (filterArm !== 'all' && arm?.name !== filterArm) return false;
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (q) {
        const matchesName = `${s.first_name} ${s.last_name}`.toLowerCase().includes(q);
        const matchesAdm = s.admission_number.toLowerCase().includes(q);
        const matchesPhone = qDigits.length >= 3 && s.guardian_phone && normalizePhone(s.guardian_phone).includes(qDigits);
        if (!matchesName && !matchesAdm && !matchesPhone) return false;
      }
      return true;
    });
  }, [students, armById, filterLevel, filterArm, filterStatus, search, showInactive]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : start + 1;
  const rangeEnd = Math.min(start + PAGE_SIZE, filtered.length);

  function resetToPage1() {
    setCurrentPage(1);
  }

  function handleExport() {
    exportToCSV(
      `students-export-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Admission No', 'Status', 'Class', 'Guardian Name', 'Guardian Phone'],
      filtered.map((s) => [
        `${s.first_name} ${s.last_name}`,
        s.admission_number,
        s.status,
        classLabel(s.current_class_arm_id),
        s.guardian_name ?? '',
        s.guardian_phone ?? ''
      ])
    );
  }

  function closePanel() {
    setPanelOpen(false);
    if (searchParams.get('add')) {
      searchParams.delete('add');
      setSearchParams(searchParams, { replace: true });
    }
  }

  return (
    <AppShell title="Students" pageClass="page-students">
      <div className="page-head">
        <div>
          <div className="eyebrow">Records</div>
          <h2>Student roster</h2>
          <p>
            Search or filter by class, or add a new student — charges are generated automatically based on the fee
            items you configured.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn-ghost" to="/class-register" style={{ textDecoration: 'none' }}>
            View by class →
          </Link>
          <button className="btn-ghost" onClick={handleExport} disabled={filtered.length === 0}>
            Export CSV
          </button>
          <button className="btn-primary" onClick={() => setPanelOpen(true)}>
            + Add student
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <select
          value={filterLevel}
          onChange={(e) => {
            setFilterLevel(e.target.value);
            setFilterArm('all');
            resetToPage1();
          }}
        >
          <option value="all">All classes</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          value={filterArm}
          onChange={(e) => {
            setFilterArm(e.target.value);
            resetToPage1();
          }}
        >
          <option value="all">All arms</option>
          {(filterLevel === 'all' ? [] : armNamesByLevel.get(filterLevel) ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            resetToPage1();
          }}
        >
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="existing">Existing</option>
        </select>
        <input
          type="text"
          placeholder="Search by name, admission number, or guardian phone…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetToPage1();
          }}
        />
        {inactiveCount > 0 && (
          <label className="inactive-toggle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => {
                setShowInactive(e.target.checked);
                resetToPage1();
              }}
            />
            Show withdrawn/graduated ({inactiveCount})
          </label>
        )}
      </div>

      <div className="result-count">
        Showing {rangeStart}–{rangeEnd} of {filtered.length} student{filtered.length !== 1 ? 's' : ''}
      </div>

      <div className="table-wrap">
        <div className="t-row head">
          <div className="col-avatar" />
          <div className="col-name">Student</div>
          <div className="col-status">Status</div>
          <div className="col-class">Class</div>
          <div className="col-action" />
        </div>
        {pageItems.length === 0 ? (
          <div className="empty-note">No students match this filter yet.</div>
        ) : (
          pageItems.map((s) => (
            <div className="t-row" key={s.id}>
              <div className="col-avatar">
                <div className="avatar">{initials(s.first_name, s.last_name)}</div>
              </div>
              <div className="col-name">
                <div className="full">
                  {s.first_name} {s.last_name}
                </div>
                <div className="adm">{s.admission_number}</div>
              </div>
              <div className="col-status">
                {s.status === 'new' && <span className="status-tag new">NEW</span>}
                {s.status === 'existing' && <span className="status-tag existing">EXISTING</span>}
                {(s.status === 'withdrawn' || s.status === 'graduated') && (
                  <span className="lifecycle-tag">{s.status.toUpperCase()}</span>
                )}
              </div>
              <div className="col-class">
                <span className="class-tag">{classLabel(s.current_class_arm_id)}</span>
              </div>
              <div className="col-action">
                <Link className="view-link" to={`/students/${s.id}`} style={{ textDecoration: 'none' }}>
                  View →
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="pagination-bar">
          <button className="page-btn" disabled={safePage === 1} onClick={() => setCurrentPage(safePage - 1)}>
            ← Prev
          </button>
          {paginationWindow(safePage, totalPages).map((p, i) =>
            p === '…' ? (
              <span className="page-ellipsis" key={`e${i}`}>
                …
              </span>
            ) : (
              <button
                key={p}
                className={`page-btn${p === safePage ? ' active' : ''}`}
                onClick={() => setCurrentPage(p)}
              >
                {p}
              </button>
            )
          )}
          <button
            className="page-btn"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage(safePage + 1)}
          >
            Next →
          </button>
        </div>
      )}

      <AddStudentPanel
        open={panelOpen}
        onClose={closePanel}
        onSaved={(name, chargeCount) => {
          closePanel();
          setToast(`${name} added — ${chargeCount} charge${chargeCount === 1 ? '' : 's'} generated`);
        }}
      />
      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </AppShell>
  );
}
