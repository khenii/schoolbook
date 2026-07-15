import { useMemo } from 'react';
import { useQuery } from '@powersync/react';

// Shared base for every school-wide (not single-student) aggregate screen —
// the dashboard, and now Reports. Both need the exact same
// "balance = amount_expected - sum(payments)" computed across every charge
// in the school, joined with class/term/session names. Previously the
// dashboard computed this inline; factoring it out here means Reports
// can't drift from the dashboard's numbers the way the old per-student
// arrears heuristic drifted before terms.is_current existed.

export interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  current_class_arm_id: string | null;
  created_at: string;
}

interface ClassArmRow {
  id: string;
  class_level_id: string;
  session_id: string;
  name: string;
}

interface ClassLevelRow {
  id: string;
  name: string;
  sort_order: number;
}

interface SessionRow {
  id: string;
  name: string;
  created_at: string;
}

interface TermRow {
  id: string;
  session_id: string;
  name: string;
  is_current: number;
  created_at: string;
}

interface ChargeRow {
  id: string;
  student_id: string;
  fee_item_id: string;
  term_id: string;
  session_id: string;
  class_level_id: string;
  amount_expected: number;
}

export interface PaymentRow {
  id: string;
  charge_id: string;
  student_id: string;
  amount_paid: number;
  date_paid: string;
  method: string;
  receipt_number: string | null;
  household_transaction_id: string | null;
  void_of_payment_id: string | null;
  void_reason: string | null;
  created_at: string;
}

interface FeeItemRow {
  id: string;
  name: string;
}

interface WriteOffRow {
  id: string;
  charge_id: string;
  amount: number;
}

export interface LedgerChargeRow extends ChargeRow {
  paid: number;
  writtenOff: number;
  balance: number;
  termName: string;
  sessionName: string;
  classLevelName: string;
  feeItemName: string;
  sortKey: string; // session.created_at__term.created_at, for chronological ordering
}

const ENROLLED_STATUSES = new Set(['new', 'existing']);

export function useSchoolLedger() {
  const { data: students } = useQuery<StudentRow>(
    'SELECT id, first_name, last_name, status, current_class_arm_id, created_at FROM students'
  );
  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, session_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>(
    'SELECT id, name, sort_order FROM class_levels ORDER BY sort_order ASC'
  );
  const { data: sessions } = useQuery<SessionRow>('SELECT id, name, created_at FROM sessions');
  const { data: terms } = useQuery<TermRow>('SELECT id, session_id, name, is_current, created_at FROM terms');
  const { data: charges } = useQuery<ChargeRow>(
    'SELECT id, student_id, fee_item_id, term_id, session_id, class_level_id, amount_expected FROM charges'
  );
  const { data: payments } = useQuery<PaymentRow>(
    `SELECT id, charge_id, student_id, amount_paid, date_paid, method, receipt_number, household_transaction_id,
            void_of_payment_id, void_reason, created_at
     FROM payments ORDER BY created_at DESC`
  );
  const { data: writeOffs } = useQuery<WriteOffRow>('SELECT id, charge_id, amount FROM write_offs');
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items');

  const armMap = useMemo(() => new Map(arms.map((a) => [a.id, a])), [arms]);
  const levelMap = useMemo(() => new Map(levels.map((l) => [l.id, l])), [levels]);
  const sessionMap = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const termMap = useMemo(() => new Map(terms.map((t) => [t.id, t])), [terms]);
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const feeItemMap = useMemo(() => new Map(feeItems.map((f) => [f.id, f])), [feeItems]);

  const classLabel = useMemo(() => {
    return (armId: string | null) => {
      if (!armId) return '—';
      const arm = armMap.get(armId);
      if (!arm) return '—';
      const level = levelMap.get(arm.class_level_id);
      return `${level?.name ?? ''} ${arm.name}`.trim();
    };
  }, [armMap, levelMap]);

  const currentTerm = useMemo(() => terms.find((t) => t.is_current) ?? null, [terms]);

  const paidByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.charge_id, (map.get(p.charge_id) ?? 0) + p.amount_paid);
    }
    return map;
  }, [payments]);

  const writtenOffByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of writeOffs) {
      map.set(w.charge_id, (map.get(w.charge_id) ?? 0) + w.amount);
    }
    return map;
  }, [writeOffs]);

  const chargeBalances = useMemo<LedgerChargeRow[]>(() => {
    return charges.map((c) => {
      const paid = paidByCharge.get(c.id) ?? 0;
      const writtenOff = writtenOffByCharge.get(c.id) ?? 0;
      const session = sessionMap.get(c.session_id);
      const term = termMap.get(c.term_id);
      return {
        ...c,
        paid,
        writtenOff,
        balance: c.amount_expected - paid - writtenOff,
        termName: term?.name ?? '',
        sessionName: session?.name ?? '',
        classLevelName: levelMap.get(c.class_level_id)?.name ?? '',
        feeItemName: feeItemMap.get(c.fee_item_id)?.name ?? '',
        sortKey: `${session?.created_at ?? ''}__${term?.created_at ?? ''}`
      };
    });
  }, [charges, paidByCharge, writtenOffByCharge, sessionMap, termMap, levelMap, feeItemMap]);

  const enrolledStudents = useMemo(() => students.filter((s) => ENROLLED_STATUSES.has(s.status)), [students]);

  return {
    students,
    studentMap,
    enrolledStudents,
    arms,
    levels,
    armMap,
    levelMap,
    classLabel,
    sessions,
    terms,
    currentTerm,
    charges,
    payments,
    writeOffs,
    paidByCharge,
    chargeBalances
  };
}
