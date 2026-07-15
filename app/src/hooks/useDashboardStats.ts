import { useMemo } from 'react';
import { useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useActiveSession } from './useActiveSession';
import { useSchoolLedger } from './useSchoolLedger';

interface SchoolRow {
  name: string;
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

// School-wide aggregates for the dashboard, built on useSchoolLedger's
// shared charge-balance computation so these numbers can never drift from
// what Reports shows for the same term.
export function useDashboardStats() {
  const { account } = useAppContext();
  const { session: activeSession } = useActiveSession();
  const { studentMap, enrolledStudents, levels, armMap, classLabel, currentTerm, chargeBalances, payments, charges } =
    useSchoolLedger();

  const { data: schoolRows } = useQuery<SchoolRow>('SELECT name FROM schools WHERE id = ?', [account.school_id]);
  const schoolName = schoolRows[0]?.name ?? '';

  const levelsWithStudents = useMemo(() => {
    const ids = new Set<string>();
    for (const s of enrolledStudents) {
      if (s.current_class_arm_id) {
        const levelId = armMap.get(s.current_class_arm_id)?.class_level_id;
        if (levelId) ids.add(levelId);
      }
    }
    return ids.size;
  }, [enrolledStudents, armMap]);

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
  }, [chargeBalances, studentMap, classLabel, currentTermId]);

  const recentActivity = useMemo<ActivityRow[]>(() => {
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

    const studentEvents: ActivityRow[] = [...studentMap.values()]
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
  }, [payments, studentMap, charges, classLabel]);

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
