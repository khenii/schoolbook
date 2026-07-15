import { useMemo, useState } from 'react';
import { useQuery } from '@powersync/react';
import AppShell from '../components/AppShell';
import { useAppContext } from '../lib/AppContext';
import { useSchoolLedger } from '../hooks/useSchoolLedger';
import { exportToCSV } from '../lib/csv';

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

type LogType = 'payment' | 'void' | 'writeoff' | 'discount' | 'student' | 'exit' | 'promotion' | 'config';

const TYPE_LABELS: Record<LogType, string> = {
  payment: 'PAYMENT',
  void: 'VOIDED',
  writeoff: 'WRITE-OFF',
  discount: 'DISCOUNT',
  student: 'STUDENT',
  exit: 'EXIT',
  promotion: 'PROMOTION',
  config: 'CONFIG'
};

const TYPE_ICONS: Record<LogType, string> = {
  payment: '₦',
  void: '✕',
  writeoff: '📝',
  discount: '%',
  student: '☺',
  exit: '🗂',
  promotion: '↑',
  config: '⚙'
};

const ACTION_LABELS: Record<string, string> = {
  'payment.recorded': 'Payment recorded',
  'payment.voided': 'Payment voided',
  'charge.written_off': 'Balance written off',
  'discount.applied': 'Discount added',
  'discount.removed': 'Discount removed',
  'student.enrolled': 'New student added',
  'student.updated': 'Student details updated',
  'student.reactivated': 'Student reactivated',
  'student.withdrawn': 'Student marked withdrawn',
  'student.graduated': 'Student marked graduated',
  'promotion.run': 'Class promoted',
  'session.created': 'Session created',
  'session.activated': 'Session set as active',
  'term.set_current': 'Term set as current',
  'charges.recurring_generated': 'Recurring charges generated',
  'class_level.added': 'Class level added',
  'class_level.removed': 'Class level removed',
  'class_arm.added': 'Class arm added',
  'class_arm.removed': 'Class arm removed',
  'fee_item.added': 'Fee item added',
  'fee_item.removed': 'Fee item removed',
  'import.students': 'Historical import — students',
  'import.charges_payments': 'Historical import — charges & payments'
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ').replace(/\./g, ' — ');
}

// Every real action string this app logs (see grep of `logAudit(` call
// sites) mapped onto the 8 event-type buckets 12-audit-log.html defines
// icons/tags for. The mockup's own bucket list doesn't have an "import"
// type, so bulk historical imports are folded into the closest existing
// bucket (new students → student, bulk charges/payments → payment) rather
// than adding a 9th color/icon the mockup never designed.
function typeFor(action: string): LogType {
  if (action === 'payment.voided') return 'void';
  if (action.startsWith('payment.') || action === 'import.charges_payments') return 'payment';
  if (action === 'charge.written_off') return 'writeoff';
  if (action.startsWith('discount.')) return 'discount';
  if (action === 'student.withdrawn' || action === 'student.graduated') return 'exit';
  if (action.startsWith('student.') || action === 'import.students') return 'student';
  if (action === 'promotion.run') return 'promotion';
  return 'config';
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const MONEY_KEYS = new Set(['amount', 'total', 'value', 'outstandingBalance']);

function formatDetail(meta: Record<string, unknown> | null): { detail: string; reason?: string } {
  if (!meta) return { detail: '—' };
  const reason = typeof meta.reason === 'string' && meta.reason.trim() ? meta.reason.trim() : undefined;
  const notes = typeof meta.notes === 'string' && meta.notes.trim() ? meta.notes.trim() : undefined;
  const parts = Object.entries(meta)
    .filter(([k, v]) => k !== 'reason' && k !== 'notes' && k !== 'studentIds' && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      if (MONEY_KEYS.has(k) && typeof v === 'number') return `₦${v.toLocaleString()}`;
      if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
      if (typeof v === 'boolean') return v ? k : `not ${k}`;
      return String(v).replace(/-/g, ' ');
    });
  return { detail: parts.join(' · ') || '—', reason: reason ?? notes };
}

// Matches 12-audit-log.html — the mockup's "who did what" event feed. The
// mockup's data is 12 fixed demo rows; this drives the same visual language
// off the real audit_log table (append-only, no UPDATE/DELETE, same as
// charges/payments), resolving actor emails and — where metadata carries a
// studentId — the student's name for the "Action — Student Name" heading.
export default function AuditLogPage() {
  const { account } = useAppContext();
  const { studentMap } = useSchoolLedger();

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

  const [typeFilter, setTypeFilter] = useState<'all' | LogType>('all');
  const [search, setSearch] = useState('');

  const entries = useMemo(() => {
    return rows.map((r) => {
      const meta = parseMetadata(r.metadata);
      const type = typeFor(r.action);
      const { detail, reason } = formatDetail(meta);
      const studentId = (meta?.studentId as string | undefined) ?? (r.entity_type === 'student' ? r.entity_id : null);
      const student = studentId ? studentMap.get(studentId) : undefined;
      const studentName = student ? `${student.first_name} ${student.last_name}` : null;
      const by = actorEmail.get(r.actor_id ?? '') ?? 'System';
      return {
        id: r.id,
        type,
        time: new Date(r.created_at).toLocaleString(),
        action: actionLabel(r.action),
        detail,
        reason,
        by,
        student: studentName
      };
    });
  }, [rows, studentMap, actorEmail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (q) {
        const hay = `${e.action} ${e.detail} ${e.by} ${e.student ?? ''} ${e.reason ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, typeFilter, search]);

  function handleExport() {
    exportToCSV(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Time', 'Type', 'Action', 'Student', 'Detail', 'Reason', 'By'],
      filtered.map((e) => [e.time, TYPE_LABELS[e.type], e.action, e.student ?? '', e.detail, e.reason ?? '', e.by])
    );
  }

  return (
    <AppShell title="Audit Log" pageClass="page-auditlog">
      <div className="page-head">
        <div>
          <div className="eyebrow">Configuration</div>
          <h2>Every consequential change, in order</h2>
          <p>
            Who did what and when — fee price changes, write-offs, voided payments, discounts, promotions, and
            withdrawals. Nothing here is editable; it's a record, not a working list. Showing the most recent 500
            entries.
          </p>
        </div>
        <button className="btn-ghost" onClick={handleExport} disabled={filtered.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="filter-bar">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | LogType)}>
          <option value="all">All event types</option>
          <option value="payment">Payments recorded</option>
          <option value="void">Payments voided</option>
          <option value="writeoff">Write-offs</option>
          <option value="discount">Discounts added</option>
          <option value="student">Student record changes</option>
          <option value="exit">Withdrawals / exits</option>
          <option value="promotion">Promotions</option>
          <option value="config">Configuration changes</option>
        </select>
        <input
          type="text"
          placeholder="Search by student, staff member, or detail…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="result-count">
        {filtered.length} event{filtered.length !== 1 ? 's' : ''}
      </div>

      <div className="log-wrap">
        {filtered.length === 0 ? (
          <div className="empty-note">No events match this filter.</div>
        ) : (
          filtered.map((e) => (
            <div className="log-row" key={e.id}>
              <div className={`log-icon ${e.type}`}>{TYPE_ICONS[e.type]}</div>
              <div className="log-body">
                <div className="log-top">
                  <div className="log-action">
                    {e.action}
                    {e.student ? ` — ${e.student}` : ''}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`log-type-tag ${e.type}`}>{TYPE_LABELS[e.type]}</span>
                    <span className="log-time">{e.time}</span>
                  </div>
                </div>
                <div className="log-detail">
                  {e.detail}
                  {e.reason && <> — <span className="quoted">"{e.reason}"</span></>}
                </div>
                <div className="log-by">{e.by}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
