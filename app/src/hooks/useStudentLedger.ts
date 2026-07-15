import { useMemo } from 'react';
import { useQuery } from '@powersync/react';

interface ChargeRow {
  id: string;
  fee_item_id: string;
  session_id: string;
  term_id: string;
  class_level_id: string;
  amount_expected: number;
}

interface ClassLevelRow {
  id: string;
  name: string;
}

interface PaymentRow {
  id: string;
  charge_id: string;
  amount_paid: number;
  date_paid: string;
  method: string;
  receipt_number: string | null;
  household_transaction_id: string | null;
  void_of_payment_id: string | null;
  void_reason: string | null;
  created_at: string;
}

interface WriteOffRow {
  id: string;
  charge_id: string;
  amount: number;
  reason: string;
  written_off_by: string | null;
  created_at: string;
}

interface FeeItemRow {
  id: string;
  name: string;
}

interface TermRow {
  id: string;
  name: string;
  is_current: number;
  created_at: string;
}

interface SessionRow {
  id: string;
  name: string;
  created_at: string;
}

export interface LedgerCharge extends ChargeRow {
  feeItemName: string;
  sessionName: string;
  termName: string;
  classLevelName: string;
  paid: number;
  writtenOff: number;
  balance: number;
  sortKey: string;
}

// Single source of truth for "how much does this student owe, and since
// when" — used by the payment form (needs outstanding charges oldest-first)
// and the profile summary (needs current-term vs. arrears split) so the two
// can never drift out of sync with each other.
//
// "Current term" is terms.is_current — one explicit, school-wide flag an
// admin sets from Settings > Sessions (see db/005_current_term.sql). Falls
// back to the most recent term the student has a charge in only if, for
// some reason, no term is flagged current yet (shouldn't happen post-migration).
export function useStudentLedger(studentId: string) {
  const { data: charges } = useQuery<ChargeRow>(
    'SELECT id, fee_item_id, session_id, term_id, class_level_id, amount_expected FROM charges WHERE student_id = ?',
    [studentId]
  );
  const { data: classLevels } = useQuery<ClassLevelRow>('SELECT id, name FROM class_levels');
  const { data: payments } = useQuery<PaymentRow>(
    'SELECT id, charge_id, amount_paid, date_paid, method, receipt_number, household_transaction_id, void_of_payment_id, void_reason, created_at FROM payments WHERE student_id = ? ORDER BY date_paid DESC, created_at DESC',
    [studentId]
  );
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items');
  const { data: terms } = useQuery<TermRow>('SELECT id, name, is_current, created_at FROM terms');
  const { data: sessions } = useQuery<SessionRow>('SELECT id, name, created_at FROM sessions');
  const { data: writeOffs } = useQuery<WriteOffRow>(
    'SELECT wo.id, wo.charge_id, wo.amount, wo.reason, wo.written_off_by, wo.created_at FROM write_offs wo WHERE wo.student_id = ?',
    [studentId]
  );

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

  const ledgerCharges: LedgerCharge[] = useMemo(() => {
    return charges.map((c) => {
      const term = terms.find((t) => t.id === c.term_id);
      const session = sessions.find((s) => s.id === c.session_id);
      const paid = paidByCharge.get(c.id) ?? 0;
      const writtenOff = writtenOffByCharge.get(c.id) ?? 0;
      return {
        ...c,
        feeItemName: feeItems.find((f) => f.id === c.fee_item_id)?.name ?? c.fee_item_id,
        sessionName: session?.name ?? '',
        termName: term?.name ?? '',
        classLevelName: classLevels.find((l) => l.id === c.class_level_id)?.name ?? '',
        paid,
        writtenOff,
        balance: c.amount_expected - paid - writtenOff,
        sortKey: `${session?.created_at ?? ''}__${term?.created_at ?? ''}`
      };
    });
  }, [charges, terms, sessions, feeItems, classLevels, paidByCharge, writtenOffByCharge]);

  const sortedByOldest = useMemo(
    () => [...ledgerCharges].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    [ledgerCharges]
  );

  const schoolCurrentTermId = terms.find((t) => t.is_current)?.id ?? null;
  const currentTermId =
    schoolCurrentTermId ?? (sortedByOldest.length > 0 ? sortedByOldest[sortedByOldest.length - 1].term_id : null);

  const currentTermCharges = ledgerCharges.filter((c) => c.term_id === currentTermId);
  const currentTermBalance = currentTermCharges.reduce((sum, c) => sum + c.balance, 0);
  const paidThisTerm = currentTermCharges.reduce((sum, c) => sum + c.paid, 0);
  const currentSessionId = currentTermCharges[0]?.session_id ?? null;

  const currentTermChargeIds = new Set(currentTermCharges.map((c) => c.id));
  const paymentsThisTermCount = payments.filter(
    (p) => p.amount_paid > 0 && currentTermChargeIds.has(p.charge_id)
  ).length;

  const arrears = sortedByOldest.filter((c) => c.term_id !== currentTermId && c.balance > 0);
  const totalArrears = arrears.reduce((sum, c) => sum + c.balance, 0);

  const outstanding = sortedByOldest.filter((c) => c.balance > 0);
  const totalOutstanding = outstanding.reduce((sum, c) => sum + c.balance, 0);

  return {
    charges: ledgerCharges,
    outstandingOldestFirst: outstanding,
    payments,
    writeOffs,
    currentTermId,
    currentSessionId,
    currentTermCharges,
    currentTermBalance,
    paidThisTerm,
    paymentsThisTermCount,
    arrears,
    totalArrears,
    totalOutstanding
  };
}
