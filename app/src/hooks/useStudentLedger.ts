import { useMemo } from 'react';
import { useQuery } from '@powersync/react';

interface ChargeRow {
  id: string;
  fee_item_id: string;
  session_id: string;
  term_id: string;
  amount_expected: number;
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

interface FeeItemRow {
  id: string;
  name: string;
}

interface TermRow {
  id: string;
  name: string;
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
  paid: number;
  balance: number;
  sortKey: string;
}

// Single source of truth for "how much does this student owe, and since
// when" — used by the payment form (needs outstanding charges oldest-first)
// and the profile summary (needs current-term vs. arrears split) so the two
// can never drift out of sync with each other.
//
// "Current term" has no explicit flag in the schema (no is_current on
// terms) — this uses the most recent term (by session/term creation order)
// that the student actually has a charge in, as a practical stand-in.
// Everything older counts as arrears. Worth revisiting once term
// progression / promotion is built and a real "current term" concept
// exists school-wide.
export function useStudentLedger(studentId: string) {
  const { data: charges } = useQuery<ChargeRow>(
    'SELECT id, fee_item_id, session_id, term_id, amount_expected FROM charges WHERE student_id = ?',
    [studentId]
  );
  const { data: payments } = useQuery<PaymentRow>(
    'SELECT id, charge_id, amount_paid, date_paid, method, receipt_number, household_transaction_id, void_of_payment_id, void_reason, created_at FROM payments WHERE student_id = ? ORDER BY date_paid DESC, created_at DESC',
    [studentId]
  );
  const { data: feeItems } = useQuery<FeeItemRow>('SELECT id, name FROM fee_items');
  const { data: terms } = useQuery<TermRow>('SELECT id, name, created_at FROM terms');
  const { data: sessions } = useQuery<SessionRow>('SELECT id, name, created_at FROM sessions');

  const paidByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.charge_id, (map.get(p.charge_id) ?? 0) + p.amount_paid);
    }
    return map;
  }, [payments]);

  const ledgerCharges: LedgerCharge[] = useMemo(() => {
    return charges.map((c) => {
      const term = terms.find((t) => t.id === c.term_id);
      const session = sessions.find((s) => s.id === c.session_id);
      const paid = paidByCharge.get(c.id) ?? 0;
      return {
        ...c,
        feeItemName: feeItems.find((f) => f.id === c.fee_item_id)?.name ?? c.fee_item_id,
        sessionName: session?.name ?? '',
        termName: term?.name ?? '',
        paid,
        balance: c.amount_expected - paid,
        sortKey: `${session?.created_at ?? ''}__${term?.created_at ?? ''}`
      };
    });
  }, [charges, terms, sessions, feeItems, paidByCharge]);

  const sortedByOldest = useMemo(
    () => [...ledgerCharges].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    [ledgerCharges]
  );

  const currentTermId = sortedByOldest.length > 0 ? sortedByOldest[sortedByOldest.length - 1].term_id : null;

  const currentTermCharges = ledgerCharges.filter((c) => c.term_id === currentTermId);
  const currentTermBalance = currentTermCharges.reduce((sum, c) => sum + c.balance, 0);

  const arrears = sortedByOldest.filter((c) => c.term_id !== currentTermId && c.balance > 0);
  const totalArrears = arrears.reduce((sum, c) => sum + c.balance, 0);

  const outstanding = sortedByOldest.filter((c) => c.balance > 0);
  const totalOutstanding = outstanding.reduce((sum, c) => sum + c.balance, 0);

  return {
    charges: ledgerCharges,
    outstandingOldestFirst: outstanding,
    payments,
    currentTermId,
    currentTermBalance,
    arrears,
    totalArrears,
    totalOutstanding
  };
}
