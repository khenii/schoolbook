import type { ReactNode } from 'react';
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
// grouping, order, and icons. "Payments" (07-payments.html) has no
// standalone route in the real app yet (payments are recorded from a
// student's profile, or via Household Payment for split payments), so it
// points at Household Payment for now. Import has no mockup — it's a
// Phase 5 addition — but slots naturally under Configuration.
const NAV_SECTIONS: NavSection[] = [
  { label: 'Overview', items: [{ to: '/', icon: '◧', label: 'Dashboard' }] },
  {
    label: 'Records',
    items: [
      { to: '/students', icon: '☺', label: 'Students' },
      { to: '/household-payment', icon: '✎', label: 'Payments' },
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
    </div>
  );
}
