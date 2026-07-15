import { useMemo } from 'react';
import { useSchoolLedger } from './useSchoolLedger';

export interface DefaulterReportRow {
  studentId: string;
  name: string;
  classLabel: string;
  classLevelName: string;
  amountOwed: number;
  hasArrears: boolean;
}

export interface ArrearsReportRow {
  key: string;
  studentId: string;
  name: string;
  currentClassLabel: string;
  currentClassLevelName: string;
  fromClassLevelName: string;
  fromTermLabel: string;
  amountOwed: number;
  sortKey: string;
}

export interface CollectionReportRow {
  classLevelId: string;
  name: string;
  expected: number;
  collected: number;
  outstanding: number;
  pct: number | null;
}

// Powers the Reports screen — Defaulters, Arrears, and Collections summary
// — all derived from the same charge-balance data the dashboard uses
// (via useSchoolLedger), so a number here can never disagree with the
// dashboard's for the same term.
export function useReportsData() {
  const { studentMap, enrolledStudents, armMap, levelMap, levels, classLabel, currentTerm, chargeBalances } =
    useSchoolLedger();

  const currentTermId = currentTerm?.id ?? null;

  // Withdrawn/graduated students are excluded from the Defaulters and
  // Arrears tabs by default (spec §3.11) — these are "who to chase" lists,
  // not factual collection totals, so an inactive student's old balance
  // shouldn't inflate them. Collections summary stays unfiltered, matching
  // the dashboard's treatment of the same distinction.
  const enrolledStudentIds = useMemo(() => new Set(enrolledStudents.map((s) => s.id)), [enrolledStudents]);

  // A student's current class level name (just "SS3", not "SS3 A") — used
  // both for display and as the value the class-level filter dropdowns
  // match against.
  const currentLevelName = useMemo(() => {
    return (armId: string | null) => {
      if (!armId) return '';
      const levelId = armMap.get(armId)?.class_level_id;
      return levelId ? (levelMap.get(levelId)?.name ?? '') : '';
    };
  }, [armMap, levelMap]);

  const currentTermCharges = useMemo(
    () => chargeBalances.filter((c) => c.term_id === currentTermId),
    [chargeBalances, currentTermId]
  );
  const arrearsCharges = useMemo(
    () =>
      chargeBalances.filter(
        (c) => c.term_id !== currentTermId && c.balance > 0 && enrolledStudentIds.has(c.student_id)
      ),
    [chargeBalances, currentTermId, enrolledStudentIds]
  );

  // ---- Defaulters: one row per student, current-term balance only ----
  const defaulters = useMemo<DefaulterReportRow[]>(() => {
    const byStudent = new Map<string, number>();
    for (const c of currentTermCharges) {
      if (c.balance <= 0 || !enrolledStudentIds.has(c.student_id)) continue;
      byStudent.set(c.student_id, (byStudent.get(c.student_id) ?? 0) + c.balance);
    }
    const arrearsStudentIds = new Set(arrearsCharges.map((c) => c.student_id));
    return Array.from(byStudent.entries()).map(([studentId, amountOwed]) => {
      const s = studentMap.get(studentId);
      const armId = s?.current_class_arm_id ?? null;
      return {
        studentId,
        name: s ? `${s.last_name} ${s.first_name}` : 'Unknown student',
        classLabel: classLabel(armId),
        classLevelName: currentLevelName(armId),
        amountOwed,
        hasArrears: arrearsStudentIds.has(studentId)
      };
    });
  }, [currentTermCharges, arrearsCharges, studentMap, classLabel, currentLevelName, enrolledStudentIds]);

  const defaulterStats = useMemo(() => {
    const totalOutstanding = defaulters.reduce((sum, d) => sum + d.amountOwed, 0);
    const avgBalance = defaulters.length > 0 ? totalOutstanding / defaulters.length : 0;
    const alsoCarryingArrears = defaulters.filter((d) => d.hasArrears).length;
    return { totalOutstanding, avgBalance, alsoCarryingArrears };
  }, [defaulters]);

  // ---- Arrears: one row per student per prior term with a balance ----
  const arrearsRows = useMemo<ArrearsReportRow[]>(() => {
    return arrearsCharges.map((c) => {
      const s = studentMap.get(c.student_id);
      const armId = s?.current_class_arm_id ?? null;
      return {
        key: c.id,
        studentId: c.student_id,
        name: s ? `${s.last_name} ${s.first_name}` : 'Unknown student',
        currentClassLabel: classLabel(armId),
        currentClassLevelName: currentLevelName(armId),
        fromClassLevelName: c.classLevelName,
        fromTermLabel: `${c.termName}, ${c.sessionName}`,
        amountOwed: c.balance,
        sortKey: c.sortKey
      };
    });
  }, [arrearsCharges, studentMap, classLabel, currentLevelName]);

  const arrearsStats = useMemo(() => {
    const totalArrears = arrearsRows.reduce((sum, r) => sum + r.amountOwed, 0);
    const studentCount = new Set(arrearsRows.map((r) => r.studentId)).size;
    const oldest = [...arrearsRows].sort((a, b) => a.sortKey.localeCompare(b.sortKey))[0];
    return {
      totalArrears,
      studentCount,
      oldestUnresolvedLabel: oldest ? oldest.fromTermLabel : null
    };
  }, [arrearsRows]);

  // ---- Collections summary: current-term expected/collected by class ----
  const collections = useMemo<CollectionReportRow[]>(() => {
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
          outstanding: info.expected - info.collected,
          pct: info.expected > 0 ? Math.round((info.collected / info.expected) * 100) : null
        };
      });
  }, [currentTermCharges, levels]);

  const collectionsStats = useMemo(() => {
    const expected = collections.reduce((sum, c) => sum + c.expected, 0);
    const collected = collections.reduce((sum, c) => sum + c.collected, 0);
    const remaining = expected - collected;
    return {
      expected,
      collected,
      remaining,
      collectedPct: expected > 0 ? Math.round((collected / expected) * 100) : null
    };
  }, [collections]);

  return {
    currentTerm,
    levels,
    defaulters,
    defaulterStats,
    arrears: arrearsRows,
    arrearsStats,
    collections,
    collectionsStats
  };
}
