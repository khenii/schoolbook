import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useActiveSession } from '../hooks/useActiveSession';
import { supabase } from '../lib/supabase';

interface NavItem {
  to: string;
  icon: string;
  label: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Matches the sidebar in every mockup (01, 04–12) exactly — section
// grouping, order, and icons. Import has no mockup — it's a Phase 5
// addition — but slots naturally under Configuration.
const NAV_SECTIONS: NavSection[] = [
  { label: 'Overview', items: [{ to: '/', icon: '◧', label: 'Dashboard' }] },
  {
    label: 'Records',
    items: [
      { to: '/students', icon: '☺', label: 'Students' },
      { to: '/payments', icon: '✎', label: 'Payments' },
      { to: '/class-register', icon: '▤', label: 'Class Register' },
      { to: '/promotion', icon: '↑', label: 'Promotion' },
      { to: '/reports', icon: '▦', label: 'Reports' }
    ]
  },
  {
    label: 'Configuration',
    items: [
      { to: '/settings', icon: '⚙', label: 'Settings' },
      { to: '/audit-log', icon: '🕐', label: 'Audit Log' },
      { to: '/import', icon: '⇪', label: 'Import' }
    ]
  }
];

// Below desktop width the sidebar gives way to a fixed bottom tab bar (the
// four sections a school actually lives in day to day) plus a "More" sheet
// for everything else — see .bottom-tabs/.more-sheet in index.css. Kept as
// a short, separate list from NAV_SECTIONS rather than derived from it,
// since the split here is about phone ergonomics (thumb reach, one-hand
// use), not the sidebar's information architecture — that also means the
// icons here don't have to match the sidebar's. They're picked to read on
// their own at a glance (no adjacent section label for context, unlike the
// sidebar), and "Class Register" is shortened to fit one line at a legible
// size rather than wrapping mid-word.
const CORE_TABS: NavItem[] = [
  { to: '/', icon: '⌂', label: 'Dashboard' },
  { to: '/students', icon: '🎓', label: 'Students' },
  { to: '/payments', icon: '₦', label: 'Payments' },
  { to: '/class-register', icon: '📋', label: 'Register' }
];

const MORE_ITEMS: NavItem[] = [
  { to: '/promotion', icon: '↑', label: 'Promotion' },
  { to: '/reports', icon: '▦', label: 'Reports' },
  { to: '/settings', icon: '⚙', label: 'Settings' },
  { to: '/audit-log', icon: '🕐', label: 'Audit Log' },
  { to: '/import', icon: '⇪', label: 'Import' }
];

function initialsOf(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'S'
  );
}

export default function AppShell({
  title,
  crumb,
  syncStatus,
  pageClass,
  children
}: {
  title?: string;
  crumb?: { label: string; to: string; current: string };
  syncStatus?: string;
  // Several mockups reuse a class name (e.g. .btn-primary, .col-status) with
  // page-specific sizing/flex-ratios that legitimately differ from page to
  // page. Those are scoped in index.css under `.page-<name> <selector>` —
  // this prop is what applies that scope, so one page's table/button sizing
  // can never leak into another's. See index.css's header comment.
  pageClass?: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const { account } = useAppContext();
  const { session: activeSession } = useActiveSession();
  const [moreOpen, setMoreOpen] = useState(false);

  // Dashboard ('/') only matches exactly, so it doesn't light up for every
  // other route; everything else matches its whole subtree (e.g. a student
  // profile at /students/:id still highlights the Students tab).
  function isActive(to: string) {
    return to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
  }

  const { data: schoolRows } = useQuery<{ name: string }>('SELECT name FROM schools WHERE id = ?', [
    account.school_id
  ]);
  const schoolName = schoolRows[0]?.name ?? 'Your school';

  const { data: termRows } = useQuery<{ name: string }>(
    'SELECT name FROM terms WHERE session_id = ? AND is_current = 1 LIMIT 1',
    [activeSession?.id ?? '']
  );
  const currentTermName = termRows[0]?.name ?? null;

  const sessionLabel =
    activeSession && currentTermName
      ? `${activeSession.name} · ${currentTermName}`
      : activeSession
        ? activeSession.name
        : 'No active session';

  return (
    <div className={pageClass ? `app-shell ${pageClass}` : 'app-shell'}>
      <div className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div className="brand-name">Schoolbook</div>
        </div>

        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-item${location.pathname === item.to ? ' active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div className="sidebar-foot">
          <div className="school-avatar">{initialsOf(schoolName)}</div>
          <div className="school-meta" style={{ flex: 1, minWidth: 0 }}>
            <div className="name" title={account.email}>
              {schoolName}
            </div>
            <div className="role" style={{ textTransform: 'capitalize' }}>
              {account.role}
            </div>
          </div>
          <span
            onClick={() => supabase.auth.signOut()}
            title="Log out"
            style={{ cursor: 'pointer', color: '#8895AF', fontSize: 12, flexShrink: 0 }}
          >
            ⏻
          </span>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          {crumb ? (
            <div className="crumb">
              <Link to={crumb.to}>{crumb.label}</Link> <span>/</span> <span className="cur">{crumb.current}</span>
            </div>
          ) : (
            <h1>{title}</h1>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {syncStatus && (
              <span style={{ fontSize: 11, color: 'var(--slate-soft)', fontFamily: "'IBM Plex Mono', monospace" }}>
                {syncStatus}
              </span>
            )}
            <div className="session-pill">
              <span className="dot" />
              {sessionLabel}
            </div>
          </div>
        </div>

        <div className="content">{children}</div>
      </div>

      <nav className="bottom-tabs">
        {CORE_TABS.map((item) => (
          <Link key={item.to} to={item.to} className={`bottom-tab${isActive(item.to) ? ' active' : ''}`}>
            <span className="bottom-tab-icon">{item.icon}</span>
            <span className="bottom-tab-label">{item.label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={`bottom-tab${moreOpen ? ' active' : ''}`}
          onClick={() => setMoreOpen(true)}
        >
          <span className="bottom-tab-icon">⋯</span>
          <span className="bottom-tab-label">More</span>
        </button>
      </nav>

      <div className={`more-sheet-overlay${moreOpen ? ' show' : ''}`} onClick={() => setMoreOpen(false)} />
      <div className={`more-sheet${moreOpen ? ' show' : ''}`}>
        <div className="more-sheet-head">
          <div className="school-avatar">{initialsOf(schoolName)}</div>
          <div className="school-meta" style={{ flex: 1, minWidth: 0 }}>
            <div className="name">{schoolName}</div>
            <div className="role" style={{ textTransform: 'capitalize' }}>
              {account.role}
            </div>
          </div>
          <span className="panel-close" onClick={() => setMoreOpen(false)}>
            ✕
          </span>
        </div>
        <div className="more-sheet-body">
          {MORE_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`more-sheet-item${isActive(item.to) ? ' active' : ''}`}
              onClick={() => setMoreOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
          <div
            className="more-sheet-item"
            onClick={() => {
              setMoreOpen(false);
              supabase.auth.signOut();
            }}
          >
            <span className="nav-icon">⏻</span>
            Log out
          </div>
        </div>
      </div>
    </div>
  );
}
