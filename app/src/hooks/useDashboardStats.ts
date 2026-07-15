import { useMemo } from 'react';
import { useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useActiveSession } from './useActiveSession';

interface SchoolRow {
  name: string;
}

interface TermRow {
  id: string;
  name: string;
  is_current: number;
}

interface StudentRow {
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
  name: string;
}

interface ClassLevelRow {
  id: string;
  name: string;
  sort_order: number;
}

interface ChargeRow {
  id: string;
  student_id: string;
  term_id: string;
  class_level_id: string;
  amount_expected: number;
}

interface PaymentRow {
  id: string;
  charge_id: string;
  student_id: string;
  amount_paid: number;
  date_paid: string;
  created_at: string;
}

export interface DefaulterRow {
  studentId: string;
  name: string;
  classLabel: string;
  amountOwed: number;
  hasArrears: boolean;
}

export interface ActivityRow {
  key: string;
  message: string;
  timestamp: string;
}

export interface ClassCollectionRow {
  classLevelId: string;
  name: string;
  expected: number;
  collected: number;
  pct: number | null;
}

const ENROLLED_STATUSES = new Set(['new', 'existing']);

// School-wide aggregates for the dashboard. Pulls raw rows from local
// PowerSync SQLite and does the aggregation client-side in JS rather than
// with SQL GROUP BY — school-scale data (hundreds to low thousands of
// rows) makes this cheap, and it lets this share the exact same
// "balance = amount_expected - sum(payments)" logic as useStudentLedger
// instead of re-deriving it in SQL.
export function useDashboardStats() {
  const { account } = useAppContext();
  const { session: activeSession } = useActiveSession();

  const { data: schoolRows } = useQuery<SchoolRow>('SELECT name FROM schools WHERE id = ?', [account.school_id]);
  const { data: terms } = useQuery<TermRow>('SELECT id, name, is_current FROM terms');
  const { data: students } = useQuery<StudentRow>(
    'SELECT id, first_name, last_name, status, current_class_arm_id, created_at FROM students'
  );
  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name, sort_order FROM class_levels ORDER BY sort_order ASC');
  const { data: charges } = useQuery<ChargeRow>(
    'SELECT id, student_id, term_id, class_level_id, amount_expected FROM charges'
  );
  const { data: payments } = useQuery<PaymentRow>(
    'SELECT id, charge_id, student_id, amount_paid, date_paid, created_at FROM payments ORDER BY created_at DESC'
  );

  const schoolName = schoolRows[0]?.name ?? '';
  const currentTerm = terms.find((t) => t.is_current) ?? null;

  const classLabel = useMemo(() => {
    const armMap = new Map(arms.map((a) => [a.id, a]));
    const levelMap = new Map(levels.map((l) => [l.id, l]));
    return (armId: string | null) => {
      if (!armId) return '—';
      const arm = armMap.get(armId);
      if (!arm) return '—';
      const level = levelMap.get(arm.class_level_id);
      return `${level?.name ?? ''} ${arm.name}`.trim();
    };
  }, [arms, levels]);

  const armToLevelId = useMemo(() => new Map(arms.map((a) => [a.id, a.class_level_id])), [arms]);

  const paidByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.charge_id, (map.get(p.charge_id) ?? 0) + p.amount_paid);
    }
    return map;
  }, [payments]);

  const enrolledStudents = useMemo(() => students.filter((s) => ENROLLED_STATUSES.has(s.status)), [students]);

  const levelsWithStudents = useMemo(() => {
    const ids = new Set<string>();
    for (const s of enrolledStudents) {
      if (s.current_class_arm_id) {
        const levelId = armToLevelId.get(s.current_class_arm_id);
        if (levelId) ids.add(levelId);
      }
    }
    return ids.size;
  }, [enrolledStudents, armToLevelId]);

  const chargeBalances = useMemo(
    () =>
      charges.map((c) => ({
        ...c,
        paid: paidByCharge.get(c.id) ?? 0,
        balance: c.amount_expected - (paidByCharge.get(c.id) ?? 0)
      })),
    [charges, paidByCharge]
  );

  const currentTermId = currentTerm?.id ?? null;
  const currentTermCharges = useMemo(
    () => chargeBalances.filter((c) => c.term_id === currentTermId),
    [chargeBalances, currentTermId]
  );
  const arrearsCharges = useMemo(
    () => chargeBalances.filter((c) => c.term_id !== currentTermId && c.balance > 0),
    [chargeBalances, currentTermId]
  );

  const collectedThisTerm = currentTermCharges.reduce((sum, c) => sum + c.paid, 0);
  const collectedThisTermStudents = new Set(
    currentTermCharges.filter((c) => c.paid > 0).map((c) => c.student_id)
  ).size;

  const outstandingThisTerm = currentTermCharges.reduce((sum, c) => (c.balance > 0 ? sum + c.balance : sum), 0);
  const outstandingThisTermStudents = new Set(
    currentTermCharges.filter((c) => c.balance > 0).map((c) => c.student_id)
  ).size;

  const totalArrears = arrearsCharges.reduce((sum, c) => sum + c.balance, 0);
  const arrearsStudents = new Set(arrearsCharges.map((c) => c.student_id)).size;

  const topDefaulters = useMemo<DefaulterRow[]>(() => {
    const byStudent = new Map<string, { amountOwed: number; hasArrears: boolean }>();
    for (const c of chargeBalances) {
      if (c.balance <= 0) continue;
      const existing = byStudent.get(c.student_id) ?? { amountOwed: 0, hasArrears: false };
      existing.amountOwed += c.balance;
      if (c.term_id !== currentTermId) existing.hasArrears = true;
      byStudent.set(c.student_id, existing);
    }
    const studentMap = new Map(students.map((s) => [s.id, s]));
    return Array.from(byStudent.entries())
      .map(([studentId, info]) => {
        const s = studentMap.get(studentId);
        return {
          studentId,
          name: s ? `${s.last_name} ${s.first_name}` : 'Unknown student',
          classLabel: classLabel(s?.current_class_arm_id ?? null),
          amountOwed: info.amountOwed,
          hasArrears: info.hasArrears
        };
      })
      .sort((a, b) => b.amountOwed - a.amountOwed)
      .slice(0, 5);
  }, [chargeBalances, students, classLabel, currentTermId]);

  const recentActivity = useMemo<ActivityRow[]>(() => {
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const chargeMap = new Map(charges.map((c) => [c.id, c]));

    const paymentEvents: ActivityRow[] = payments
      .filter((p) => p.amount_paid > 0)
      .slice(0, 6)
      .map((p) => {
        const charge = chargeMap.get(p.charge_id);
        const s = charge ? studentMap.get(charge.student_id) : undefined;
        const name = s ? `${s.last_name} ${s.first_name}` : 'A student';
        return {
          key: `payment-${p.id}`,
          message: `${name} — ₦${p.amount_paid.toLocaleString()} payment recorded`,
          timestamp: p.created_at
        };
      });

    const studentEvents: ActivityRow[] = [...students]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 4)
      .map((s) => ({
        key: `student-${s.id}`,
        message: `${s.last_name} ${s.first_name} added as a new student — ${classLabel(s.current_class_arm_id)}`,
        timestamp: s.created_at
      }));

    return [...paymentEvents, ...studentEvents]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 6);
  }, [payments, students, charges, classLabel]);

  const classCollectionRates = useMemo<ClassCollectionRow[]>(() => {
    const byLevel = new Map<string, { expected: number; collected: number }>();
    for (const c of currentTermCharges) {
      const existing = byLevel.get(c.class_level_id) ?? { expected: 0, collected: 0 };
      existing.expected += c.amount_expected;
      existing.collected += c.paid;
      byLevel.set(c.class_level_id, existing);
    }
    return levels
      .filter((l) => byLevel.has(l.id))
      .map((l) => {
        const info = byLevel.get(l.id)!;
        return {
          classLevelId: l.id,
          name: l.name,
          expected: info.expected,
          collected: info.collected,
          pct: info.expected > 0 ? Math.round((info.collected / info.expected) * 100) : null
        };
      });
  }, [currentTermCharges, levels]);

  return {
    schoolName,
    activeSession,
    currentTerm,
    totalStudents: enrolledStudents.length,
    levelsWithStudents,
    collectedThisTerm,
    collectedThisTermStudents,
    outstandingThisTerm,
    outstandingThisTermStudents,
    totalArrears,
    arrearsStudents,
    topDefaulters,
    recentActivity,
    classCollectionRates
  };
}
