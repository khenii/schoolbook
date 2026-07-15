import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: string | null;
  created_at: string;
}

interface AccountRow {
  id: string;
  email: string;
}

const tableWrapStyle: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  overflow: 'hidden'
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
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

// Coarse grouping so the filter dropdown isn't 30 raw action strings —
// entity_type is already a reasonable bucket (student, payment, charge,
// discount, class_arm, class_level, fee_item, session, term).
function actionLabel(action: string) {
  return action.replace(/_/g, ' ').replace(/\./g, ' — ');
}

export default function AuditLogPage() {
  const { account } = useAppContext();

  const { data: rows } = useQuery<AuditRow>(
    'SELECT id, actor_id, action, entity_type, entity_id, metadata, created_at FROM audit_log WHERE school_id = ? ORDER BY created_at DESC LIMIT 500',
    [account.school_id]
  );
  const { data: accounts } = useQuery<AccountRow>('SELECT id, email FROM accounts');

  const actorEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) map.set(a.id, a.email);
    return map;
  }, [accounts]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.entity_type);
    return Array.from(set).sort();
  }, [rows]);

  const [entityFilter, setEntityFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = rows;
    if (entityFilter !== 'all') list = list.filter((r) => r.entity_type === entityFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.action.toLowerCase().includes(q) ||
          (r.metadata ?? '').toLowerCase().includes(q) ||
          (actorEmail.get(r.actor_id ?? '') ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, entityFilter, search, actorEmail]);

  function formatMetadata(raw: string | null) {
    if (!raw) return '—';
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const parts = Object.entries(obj)
        .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length > 6))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : String(v)}`);
      return parts.join(', ') || '—';
    } catch {
      return raw;
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
      <h1 style={{ marginBottom: 2 }}>Audit log</h1>
      <p style={{ color: '#64748b', margin: '0 0 16px' }}>
        A running record of who did what — enrollments, payments, voids, write-offs, discounts, promotions,
        withdrawals, and structural changes to sessions, classes, and fee items. This is a read-only history; it
        can't be edited or deleted. Showing the most recent 500 entries.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
          <option value="all">All types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          placeholder="Search action, person, or details…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>

      <div style={tableWrapStyle}>
        <div style={headRowStyle}>
          <span style={{ width: 140 }}>When</span>
          <span style={{ width: 160 }}>Who</span>
          <span style={{ width: 170 }}>Action</span>
          <span style={{ flex: 1 }}>Details</span>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 16, color: '#888', fontSize: 12.5 }}>No matching entries.</div>
        ) : (
          filtered.map((r) => (
            <div key={r.id} style={rowStyle}>
              <span style={{ width: 140, color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
              <span style={{ width: 160 }}>{actorEmail.get(r.actor_id ?? '') ?? 'System'}</span>
              <span style={{ width: 170, textTransform: 'capitalize' }}>{actionLabel(r.action)}</span>
              <span style={{ flex: 1, color: '#555' }}>{formatMetadata(r.metadata)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
