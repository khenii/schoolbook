import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import AppShell from '../components/AppShell';
import { useAppContext } from '../lib/AppContext';
import { useSchoolLedger } from '../hooks/useSchoolLedger';
import type { LedgerChargeRow } from '../hooks/useSchoolLedger';
import { normalizePhone } from '../lib/households';
import { logAudit } from '../lib/auditLog';
import { exportToCSV } from '../lib/csv';

type Method = 'cash' | 'bank-transfer' | 'pos' | 'other';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  'bank-transfer': 'Bank transfer',
  pos: 'POS',
  other: 'Other'
};

interface HouseholdRow {
  id: string;
  name: string;
  phone: string | null;
}

interface StudentGuardianRow {
  id: string;
  first_name: string;
  last_name: string;
  household_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  current_class_arm_id: string | null;
  status: string;
}

interface GroupMember {
  studentId: string;
  name: string;
  classLabel: string;
  balance: number;
}

interface HouseholdGroup {
  key: string;
  householdId: string | null;
  label: string;
  sublabel: string;
  members: GroupMember[];
}

// Same "oldest debt first" allocation used everywhere else a payment is
// recorded — spec §3.2/§3.3.
function allocateOldestFirst(chargeBalances: LedgerChargeRow[], studentId: string, amount: number) {
  const outstanding = chargeBalances
    .filter((c) => c.student_id === studentId && c.balance > 0)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const allocations: { chargeId: string; amount: number }[] = [];
  let remaining = amount;
  for (const charge of outstanding) {
    if (remaining <= 0) break;
    const allocated = Math.min(charge.balance, remaining);
    allocations.push({ chargeId: charge.id, amount: allocated });
    remaining -= allocated;
  }
  return allocations;
}

// The school-wide "Payment log" from 07-payments.html — filters, stats, a
// unified record-payment panel (single student, or a household split), and
// void. Rows are grouped by household_transaction_id (one line per amount
// actually received, e.g. a single ₦20,000 handed over covering 3 charges
// or 2 siblings) rather than the mockup's flat one-row-per-charge list —
// that grouping already existed on the old Household Payment page and on a
// student's own payment history, and dropping it here would be a real
// regression, not just a style difference.
export default function PaymentsPage() {
  const db = usePowerSync();
  const navigate = useNavigate();
  const { account } = useAppContext();
  const [searchParams] = useSearchParams();

  const { studentMap, armMap, levels, classLabel, currentTerm, payments, chargeBalances } = useSchoolLedger();

  const { data: households } = useQuery<HouseholdRow>('SELECT id, name, phone FROM households');
  const { data: studentGuardians } = useQuery<StudentGuardianRow>(
    "SELECT id, first_name, last_name, household_id, guardian_name, guardian_phone, current_class_arm_id, status FROM students WHERE status NOT IN ('withdrawn', 'graduated')"
  );

  const balanceByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of chargeBalances) {
      if (c.balance <= 0) continue;
      map.set(c.student_id, (map.get(c.student_id) ?? 0) + c.balance);
    }
    return map;
  }, [chargeBalances]);

  const chargeById = useMemo(() => new Map(chargeBalances.map((c) => [c.id, c])), [chargeBalances]);
  const householdIdByStudent = useMemo(() => new Map(studentGuardians.map((s) => [s.id, s.household_id])), [studentGuardians]);
  const householdById = useMemo(() => new Map(households.map((h) => [h.id, h])), [households]);

  const today = new Date().toISOString().slice(0, 10);

  // ---------------- filters ----------------
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterDate, setFilterDate] = useState('all');
  const [search, setSearch] = useState('');

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      const student = studentMap.get(p.student_id);
      if (filterLevel !== 'all') {
        const arm = student?.current_class_arm_id ? armMap.get(student.current_class_arm_id) : undefined;
        if (arm?.class_level_id !== filterLevel) return false;
      }
      if (filterMethod !== 'all' && p.method !== filterMethod) return false;
      if (filterDate === 'today' && p.date_paid !== today) return false;
      if (filterDate === 'week') {
        const diffDays = (new Date(today).getTime() - new Date(p.date_paid).getTime()) / 86400000;
        if (!(diffDays >= 0 && diffDays <= 7)) return false;
      }
      if (filterDate === 'term') {
        const charge = chargeById.get(p.charge_id);
        if (!currentTerm || charge?.term_id !== currentTerm.id) return false;
      }
      if (q) {
        const name = student ? `${student.first_name} ${student.last_name}`.toLowerCase() : '';
        const matchesName = name.includes(q);
        const matchesReceipt = (p.receipt_number ?? '').toLowerCase().includes(q);
        if (!matchesName && !matchesReceipt) return false;
      }
      return true;
    });
  }, [payments, studentMap, armMap, filterLevel, filterMethod, filterDate, search, chargeById, currentTerm, today]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof filteredPayments>();
    for (const p of filteredPayments) {
      const key = p.household_transaction_id ?? p.id;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, rows]) => {
        const studentIds = Array.from(new Set(rows.map((r) => r.student_id)));
        const voidedIds = new Set(rows.filter((r) => r.void_of_payment_id).map((r) => r.void_of_payment_id));
        return {
          key,
          rows,
          studentIds,
          total: rows.reduce((s, r) => s + r.amount_paid, 0),
          date: rows[0].date_paid,
          method: rows[0].method,
          receiptNumber: rows.find((r) => r.receipt_number)?.receipt_number ?? null,
          createdAt: rows[0].created_at,
          hasVoid: voidedIds.size > 0,
          voidable: rows.length === 1 && !rows[0].void_of_payment_id && rows[0].amount_paid > 0 && !voidedIds.has(rows[0].id)
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [filteredPayments]);

  const statTotal = filteredPayments.reduce((s, p) => s + p.amount_paid, 0);
  const todaysTotal = payments.filter((p) => p.date_paid === today).reduce((s, p) => s + p.amount_paid, 0);
  const todaysCount = new Set(
    payments.filter((p) => p.date_paid === today && p.amount_paid > 0).map((p) => p.household_transaction_id ?? p.id)
  ).size;

  function groupStudentLabel(g: (typeof groups)[number]) {
    if (g.studentIds.length === 1) {
      const s = studentMap.get(g.studentIds[0]);
      return { n: s ? `${s.first_name} ${s.last_name}` : 'Unknown student', c: s ? classLabel(s.current_class_arm_id) : '' };
    }
    const householdId = householdIdByStudent.get(g.studentIds[0]);
    const household = householdId ? householdById.get(householdId) : null;
    return { n: household?.name ?? 'Household split', c: `${g.studentIds.length} children` };
  }

  function groupFeeLabel(g: (typeof groups)[number]) {
    if (g.rows.length === 1) {
      const c = chargeById.get(g.rows[0].charge_id);
      return c ? c.feeItemName : '—';
    }
    return g.studentIds.length > 1 ? `Household split (${g.rows.length} charges)` : `${g.rows.length} charges`;
  }

  function handleExport() {
    exportToCSV(
      `payments-export-${today}.csv`,
      ['Date', 'Student', 'Class', 'Fee item', 'Method', 'Receipt No', 'Amount'],
      groups.map((g) => {
        const label = groupStudentLabel(g);
        return [g.date, label.n, label.c, groupFeeLabel(g), METHOD_LABEL[g.method] ?? g.method, g.receiptNumber ?? '', g.total];
      })
    );
  }

  // ---------------- void ----------------
  const [voidTarget, setVoidTarget] = useState<{ id: string; studentId: string; amount: number; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSaving, setVoidSaving] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  function openVoid(g: (typeof groups)[number]) {
    const r = g.rows[0];
    const label = groupStudentLabel(g);
    setVoidTarget({ id: r.id, studentId: r.student_id, amount: r.amount_paid, label: `${label.n} · ₦${r.amount_paid.toLocaleString()} · ${g.receiptNumber ?? '—'}` });
    setVoidReason('');
    setVoidError(null);
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      setVoidError('A reason is required before a payment can be voided.');
      return;
    }
    setVoidSaving(true);
    try {
      const r = payments.find((p) => p.id === voidTarget.id)!;
      const now = new Date().toISOString();
      const voidId = crypto.randomUUID();
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO payments
             (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
              household_transaction_id, void_of_payment_id, void_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            voidId,
            account.school_id,
            r.student_id,
            r.charge_id,
            -r.amount_paid,
            now.slice(0, 10),
            r.method,
            r.receipt_number ? `VOID-${r.receipt_number}` : null,
            account.id,
            r.household_transaction_id,
            r.id,
            voidReason.trim(),
            now
          ]
        );
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: 'payment.voided',
          entityType: 'payment',
          entityId: r.id,
          metadata: { studentId: r.student_id, amount: r.amount_paid, reason: voidReason.trim() }
        });
      });
      setVoidTarget(null);
      notify(`Payment voided — ₦${r.amount_paid.toLocaleString()} added back to the student's balance`);
    } finally {
      setVoidSaving(false);
    }
  }

  // ---------------- record payment panel ----------------
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<'single' | 'household'>('single');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<Method>('cash');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function notify(msg: string) {
    setToast(msg);
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // single mode
  const enrolledSorted = useMemo(
    () => studentGuardians.slice().sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [studentGuardians]
  );
  const [singleStudentId, setSingleStudentId] = useState('');
  const [singleAmount, setSingleAmount] = useState('');
  const singleBalance = singleStudentId ? balanceByStudent.get(singleStudentId) ?? 0 : 0;

  // household mode
  const [householdSearch, setHouseholdSearch] = useState('');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [splits, setSplits] = useState<Record<string, string>>({});
  const [householdTotal, setHouseholdTotal] = useState('');

  const householdMatches = useMemo<HouseholdGroup[]>(() => {
    const q = householdSearch.trim().toLowerCase();
    if (!q) return [];
    const qDigits = normalizePhone(householdSearch.trim());
    const matchedIds = new Set(
      households
        .filter((h) => h.name.toLowerCase().includes(q) || (qDigits.length >= 4 && normalizePhone(h.phone ?? '').includes(qDigits)))
        .map((h) => h.id)
    );
    const result: HouseholdGroup[] = [];
    for (const h of households) {
      if (!matchedIds.has(h.id)) continue;
      const members = studentGuardians.filter((s) => s.household_id === h.id);
      if (members.length === 0) continue;
      result.push({
        key: `household:${h.id}`,
        householdId: h.id,
        label: h.name,
        sublabel: h.phone ? `${h.phone} · ${members.length} student${members.length === 1 ? '' : 's'}` : `${members.length} student${members.length === 1 ? '' : 's'}`,
        members: members.map((s) => ({
          studentId: s.id,
          name: `${s.first_name} ${s.last_name}`,
          classLabel: classLabel(s.current_class_arm_id),
          balance: balanceByStudent.get(s.id) ?? 0
        }))
      });
    }
    for (const s of studentGuardians) {
      if (s.household_id) continue;
      const nameMatch = (s.guardian_name ?? '').toLowerCase().includes(q);
      const phoneMatch = qDigits.length >= 4 && normalizePhone(s.guardian_phone ?? '').includes(qDigits);
      if (!nameMatch && !phoneMatch) continue;
      result.push({
        key: `solo:${s.id}`,
        householdId: null,
        label: s.guardian_name || 'Guardian',
        sublabel: `${s.guardian_phone ?? 'no phone on file'} · not linked to a household`,
        members: [{ studentId: s.id, name: `${s.first_name} ${s.last_name}`, classLabel: classLabel(s.current_class_arm_id), balance: balanceByStudent.get(s.id) ?? 0 }]
      });
    }
    return result;
  }, [householdSearch, households, studentGuardians, classLabel, balanceByStudent]);

  function selectHouseholdById(householdId: string) {
    const h = householdById.get(householdId);
    if (!h) return;
    const members = studentGuardians.filter((s) => s.household_id === householdId);
    const key = `household:${householdId}`;
    setSelectedGroupKey(key);
    setHouseholdSearch(h.name);
    setSplits({});
    // stash a synthetic group so selection works even without a live search match
    setDirectGroup({
      key,
      householdId,
      label: h.name,
      sublabel: `${members.length} student${members.length === 1 ? '' : 's'}`,
      members: members.map((s) => ({
        studentId: s.id,
        name: `${s.first_name} ${s.last_name}`,
        classLabel: classLabel(s.current_class_arm_id),
        balance: balanceByStudent.get(s.id) ?? 0
      }))
    });
  }

  const [directGroup, setDirectGroup] = useState<HouseholdGroup | null>(null);
  const selectedGroup = directGroup?.key === selectedGroupKey ? directGroup : householdMatches.find((g) => g.key === selectedGroupKey) ?? null;

  const householdOwed = selectedGroup ? selectedGroup.members.reduce((s, m) => s + m.balance, 0) : 0;
  const totalNum = Number(householdTotal) || 0;
  const allocated = Object.values(splits).reduce((s, v) => s + (Number(v) || 0), 0);
  const remaining = totalNum - allocated;

  function suggestSplit() {
    if (!selectedGroup || totalNum <= 0) return;
    const next: Record<string, string> = {};
    let left = totalNum;
    selectedGroup.members.forEach((m, idx) => {
      const isLast = idx === selectedGroup.members.length - 1;
      let share: number;
      if (isLast) {
        share = Math.max(0, Math.min(left, m.balance));
      } else {
        share = householdOwed > 0 ? Math.round(totalNum * (m.balance / householdOwed)) : 0;
        share = Math.max(0, Math.min(share, m.balance, left));
      }
      next[m.studentId] = share > 0 ? String(share) : '';
      left -= share;
    });
    setSplits(next);
  }

  function openPanel() {
    setPanelOpen(true);
    setMode('single');
    setError(null);
    setSingleStudentId('');
    setSingleAmount('');
    setDate(new Date().toISOString().slice(0, 10));
    setMethod('cash');
    setReceiptNumber('');
  }
  function closePanel() {
    setPanelOpen(false);
  }

  // Deep link from a student profile's "Pay for whole family" — opens
  // straight into household mode for that family, per the mockup's own
  // `?household=` behavior.
  useEffect(() => {
    const hid = searchParams.get('household');
    if (hid && households.some((h) => h.id === hid)) {
      setPanelOpen(true);
      setMode('household');
      selectHouseholdById(hid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [households.length]);

  async function handleSave() {
    setError(null);

    if (mode === 'single') {
      const amount = Number(singleAmount);
      if (!singleStudentId) {
        setError('Select a student first.');
        return;
      }
      if (!amount || amount <= 0) {
        setError('Enter an amount greater than zero.');
        return;
      }
      if (amount > singleBalance) {
        setError(`Amount exceeds this student's outstanding balance (₦${singleBalance.toLocaleString()}).`);
        return;
      }
      setSaving(true);
      try {
        const transactionId = crypto.randomUUID();
        const now = new Date().toISOString();
        const allocations = allocateOldestFirst(chargeBalances, singleStudentId, amount);
        await db.writeTransaction(async (tx) => {
          for (const a of allocations) {
            await tx.execute(
              `INSERT INTO payments
                 (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
                  household_transaction_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [crypto.randomUUID(), account.school_id, singleStudentId, a.chargeId, a.amount, date, method, receiptNumber.trim() || null, account.id, transactionId, now]
            );
          }
          await logAudit(tx, {
            schoolId: account.school_id,
            actorId: account.id,
            action: 'payment.recorded',
            entityType: 'payment',
            entityId: transactionId,
            metadata: { studentId: singleStudentId, total: amount, method, chargeCount: allocations.length, via: 'payments-log' }
          });
        });
        closePanel();
        navigate(`/receipt/${transactionId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setSaving(false);
      }
      return;
    }

    // household mode
    if (!selectedGroup) {
      setError('Select a household first.');
      return;
    }
    if (!totalNum || totalNum <= 0) {
      setError('Enter the total amount received.');
      return;
    }
    if (totalNum > householdOwed) {
      setError(`Amount exceeds this household's total outstanding balance (₦${householdOwed.toLocaleString()}).`);
      return;
    }
    if (remaining !== 0) {
      setError(remaining > 0 ? `₦${remaining.toLocaleString()} of the total hasn't been assigned yet.` : `₦${Math.abs(remaining).toLocaleString()} more has been assigned than the total received.`);
      return;
    }
    for (const m of selectedGroup.members) {
      const amt = Number(splits[m.studentId]) || 0;
      if (amt > m.balance) {
        setError(`${m.name}'s share exceeds their outstanding balance (₦${m.balance.toLocaleString()}).`);
        return;
      }
    }
    setSaving(true);
    try {
      const transactionId = crypto.randomUUID();
      const now = new Date().toISOString();
      const perChild = selectedGroup.members
        .map((m) => ({ studentId: m.studentId, amount: Number(splits[m.studentId]) || 0 }))
        .filter((a) => a.amount > 0)
        .map((a) => ({ ...a, allocations: allocateOldestFirst(chargeBalances, a.studentId, a.amount) }));

      await db.writeTransaction(async (tx) => {
        for (const child of perChild) {
          for (const alloc of child.allocations) {
            await tx.execute(
              `INSERT INTO payments
                 (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
                  household_transaction_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [crypto.randomUUID(), account.school_id, child.studentId, alloc.chargeId, alloc.amount, date, method, receiptNumber.trim() || null, account.id, transactionId, now]
            );
          }
        }
        await logAudit(tx, {
          schoolId: account.school_id,
          actorId: account.id,
          action: 'payment.recorded',
          entityType: 'payment',
          entityId: transactionId,
          metadata: { total: totalNum, method, studentCount: perChild.length, studentIds: perChild.map((c) => c.studentId), via: 'payments-log' }
        });
      });
      closePanel();
      notify(`₦${totalNum.toLocaleString()} split across ${perChild.length} student${perChild.length === 1 ? '' : 's'}`);
      setHouseholdTotal('');
      setSplits({});
      setSelectedGroupKey(null);
      setHouseholdSearch('');
      setDirectGroup(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Payments" pageClass="page-payments">
      <div className="page-head">
        <div>
          <div className="eyebrow">Records</div>
          <h2>Payment log</h2>
          <p>
            Every payment recorded across the school, most recent first. Filter by date, class, or method — or find
            a specific student and record a new one.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn-ghost" to="/class-register" style={{ textDecoration: 'none' }}>
            View by class →
          </Link>
          <button className="btn-ghost" onClick={handleExport} disabled={groups.length === 0}>
            Export CSV
          </button>
          <button className="btn-primary" onClick={openPanel}>
            + Record payment
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="label">Showing</div>
          <div className="value">{groups.length}</div>
          <div className="sub">payments in current filter</div>
        </div>
        <div className="stat-card">
          <div className="label">Total in filter</div>
          <div className="value">₦{statTotal.toLocaleString()}</div>
          <div className="sub">sum of amounts shown</div>
        </div>
        <div className="stat-card">
          <div className="label">Today's collections</div>
          <div className="value">₦{todaysTotal.toLocaleString()}</div>
          <div className="sub">
            {todaysCount} payment{todaysCount === 1 ? '' : 's'} recorded today
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
          <option value="all">All classes</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select value={filterMethod} onChange={(e) => setFilterMethod(e.target.value)}>
          <option value="all">All methods</option>
          <option value="cash">Cash</option>
          <option value="bank-transfer">Bank transfer</option>
          <option value="pos">POS</option>
          <option value="other">Other</option>
        </select>
        <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="term">This term</option>
        </select>
        <input type="text" placeholder="Search by student, receipt no…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="result-count">
        {groups.length} payment{groups.length !== 1 ? 's' : ''}
      </div>

      <div className="table-wrap">
        <div className="t-row head">
          <div className="col-date">Date</div>
          <div className="col-student">Student</div>
          <div className="col-fee">Fee item</div>
          <div className="col-method">Method</div>
          <div className="col-receipt">Receipt</div>
          <div className="col-amt">Amount</div>
          <div className="col-void-action" />
        </div>
        {groups.length === 0 ? (
          <div className="empty-note">No payments match this filter.</div>
        ) : (
          groups.map((g) => {
            const label = groupStudentLabel(g);
            const isVoidRow = g.rows.length === 1 && !!g.rows[0].void_of_payment_id;
            return (
              <div className={`t-row${g.hasVoid || isVoidRow ? ' voided-row' : ''}`} key={g.key}>
                <div className="col-date">{g.date}</div>
                <div className="col-student">
                  <div className="n">
                    {g.studentIds.length === 1 ? (
                      <Link to={`/students/${g.studentIds[0]}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {label.n}
                      </Link>
                    ) : (
                      label.n
                    )}
                  </div>
                  <div className="c">{label.c}</div>
                </div>
                <div className="col-fee">
                  {groupFeeLabel(g)}
                  {isVoidRow && <div className="void-reason">Voided: "{g.rows[0].void_reason}"</div>}
                </div>
                <div className="col-method">
                  <span className="method-tag">{METHOD_LABEL[g.method] ?? g.method}</span>
                </div>
                <div className="col-receipt">{g.receiptNumber ?? '—'}</div>
                <div className="col-amt">
                  {isVoidRow ? <span className="voided-amt">₦{Math.abs(g.total).toLocaleString()}</span> : `${g.total < 0 ? '-' : '+'}₦${Math.abs(g.total).toLocaleString()}`}
                </div>
                <div className="col-void-action">
                  {isVoidRow ? (
                    <span className="void-tag">VOIDED</span>
                  ) : (
                    <div className="row-actions">
                      <Link className="row-action" to={`/receipt/${g.key}`}>
                        Receipt
                      </Link>
                      {g.voidable && (
                        <>
                          <span className="row-action-sep" />
                          <span className="row-action danger" onClick={() => openVoid(g)}>
                            Void
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* RECORD PAYMENT PANEL */}
      <div className={`overlay${panelOpen ? ' show' : ''}`} onClick={closePanel} />
      <div className={`panel${panelOpen ? ' show' : ''}`}>
        <div className="panel-head">
          <div>
            <h3>Record a payment</h3>
            <p>
              {mode === 'single'
                ? 'Search for a student to see their outstanding balance first.'
                : 'Pick a household to see every linked child and split one payment across them.'}
            </p>
          </div>
          <div className="panel-close" onClick={closePanel}>
            ✕
          </div>
        </div>
        <div className="panel-body">
          <div className="field">
            <label>Payment for</label>
            <div className="mode-toggle">
              <div className={mode === 'single' ? 'sel' : ''} onClick={() => setMode('single')}>
                One student
              </div>
              <div className={mode === 'household' ? 'sel' : ''} onClick={() => setMode('household')}>
                Whole household (split)
              </div>
            </div>
          </div>

          {mode === 'single' ? (
            <>
              <div className="field">
                <label>Student</label>
                <select value={singleStudentId} onChange={(e) => setSingleStudentId(e.target.value)}>
                  <option value="">Select a student…</option>
                  {enrolledSorted.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.first_name} {s.last_name} — {classLabel(s.current_class_arm_id)}
                    </option>
                  ))}
                </select>
              </div>
              {singleStudentId && (
                <div className="balance-note">
                  {singleBalance > 0 ? (
                    <>
                      Currently owes <b>₦{singleBalance.toLocaleString()}</b>. This payment will be applied to the
                      oldest outstanding balance first.
                    </>
                  ) : (
                    'This student has no outstanding balance right now.'
                  )}
                </div>
              )}
              <div className="field">
                <label>Amount received</label>
                <input type="number" placeholder="e.g. 40000" value={singleAmount} onChange={(e) => setSingleAmount(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Household</label>
                <input
                  type="text"
                  placeholder="Search by household name or guardian phone…"
                  value={householdSearch}
                  onChange={(e) => {
                    setHouseholdSearch(e.target.value);
                    setSelectedGroupKey(null);
                    setDirectGroup(null);
                  }}
                />
              </div>
              {householdSearch.trim() && !selectedGroup && (
                <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
                  {householdMatches.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: 'var(--slate-soft)' }}>No match.</div>
                  ) : (
                    householdMatches.map((g) => (
                      <div
                        key={g.key}
                        onClick={() => {
                          setSelectedGroupKey(g.key);
                          setDirectGroup(null);
                        }}
                        style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 12.5 }}
                      >
                        <div style={{ fontWeight: 600 }}>{g.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--slate-soft)' }}>{g.sublabel}</div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {selectedGroup && (
                <>
                  <div className="field">
                    <label>Total amount received</label>
                    <input type="number" placeholder="e.g. 300000" value={householdTotal} onChange={(e) => setHouseholdTotal(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--slate)' }}>Split across children</label>
                    <span className="mini-btn" onClick={suggestSplit}>
                      Suggest split by balance
                    </span>
                  </div>
                  <div className="split-table">
                    {selectedGroup.members.map((m) => (
                      <div className="split-row" key={m.studentId}>
                        <div className="split-name">
                          <div className="n">{m.name}</div>
                          <div className="b">
                            {m.classLabel} · owes ₦{m.balance.toLocaleString()}
                          </div>
                        </div>
                        <input
                          type="number"
                          value={splits[m.studentId] ?? ''}
                          onChange={(e) => setSplits((prev) => ({ ...prev, [m.studentId]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className={`split-remaining ${totalNum > 0 ? (remaining === 0 ? 'ok' : 'bad') : ''}`}>
                    {totalNum > 0 ? (remaining === 0 ? 'Fully allocated ✓' : remaining > 0 ? `₦${remaining.toLocaleString()} not yet allocated` : `₦${Math.abs(remaining).toLocaleString()} over-allocated`) : ''}
                  </div>
                </>
              )}
            </>
          )}

          <div className="field-row" style={{ marginTop: 15 }}>
            <div className="field">
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                <option value="cash">Cash</option>
                <option value="bank-transfer">Bank transfer</option>
                <option value="pos">POS</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Receipt number</label>
            <input type="text" placeholder="e.g. RCT-2217" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} />
          </div>
          {error && (
            <p className="field-error" style={{ display: 'block' }}>
              {error}
            </p>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
            {saving ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </div>

      {/* VOID PANEL */}
      <div className={`overlay${voidTarget ? ' show' : ''}`} onClick={() => setVoidTarget(null)} />
      <div className={`panel${voidTarget ? ' show' : ''}`}>
        <div className="panel-head">
          <div>
            <h3>Void this payment</h3>
            <p>{voidTarget?.label ?? ''}</p>
          </div>
          <div className="panel-close" onClick={() => setVoidTarget(null)}>
            ✕
          </div>
        </div>
        <div className="panel-body">
          <div className="allocation-note" style={{ borderColor: 'var(--rust)', background: 'var(--rust-bg)' }}>
            Voiding never deletes the record — it stays visible, struck through, with the reason attached. The
            amount is added back to the student's outstanding balance.
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label>
              Reason <span className="required-mark">*required</span>
            </label>
            <textarea
              placeholder="e.g. Entered against the wrong student — correct payment recorded separately."
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
            {voidError && (
              <div className="field-error" style={{ display: 'block' }}>
                {voidError}
              </div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          <button className="btn-primary" style={{ width: '100%', background: 'var(--rust)' }} onClick={confirmVoid} disabled={voidSaving}>
            {voidSaving ? 'Saving…' : 'Confirm void'}
          </button>
        </div>
      </div>

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </AppShell>
  );
}
