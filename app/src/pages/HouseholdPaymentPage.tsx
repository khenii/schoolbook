import { Fragment, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../lib/AppContext';
import { useSchoolLedger } from '../hooks/useSchoolLedger';
import { normalizePhone } from '../lib/households';

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

type Method = 'cash' | 'bank-transfer' | 'pos' | 'other';

interface GroupMember {
  studentId: string;
  name: string;
  classLabel: string;
  balance: number;
}

interface Group {
  key: string;
  label: string;
  sublabel: string;
  members: GroupMember[];
}

// Same "oldest debt first" allocation PaymentSection uses for a single
// student, applied per household member here — spec §3.6: splitting a
// lump sum across siblings still produces one Payment row per student per
// charge, just sharing a household_transaction_id.
function allocateOldestFirst(chargeBalances: ReturnType<typeof useSchoolLedger>['chargeBalances'], studentId: string, amount: number) {
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

export default function HouseholdPaymentPage() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const { chargeBalances, classLabel, payments: allPayments, studentMap: allStudentsMap } = useSchoolLedger();

  const { data: households } = useQuery<HouseholdRow>('SELECT id, name, phone FROM households');
  const { data: students } = useQuery<StudentGuardianRow>(
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

  const [search, setSearch] = useState('');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  const groups = useMemo<Group[]>(() => {
    const q = search.trim().toLowerCase();
    const qDigits = normalizePhone(search.trim());
    if (!q) return [];

    const matchedHouseholdIds = new Set(
      households
        .filter((h) => h.name.toLowerCase().includes(q) || (qDigits.length >= 4 && normalizePhone(h.phone ?? '').includes(qDigits)))
        .map((h) => h.id)
    );

    const result: Group[] = [];

    for (const h of households) {
      if (!matchedHouseholdIds.has(h.id)) continue;
      const members = students.filter((s) => s.household_id === h.id);
      if (members.length === 0) continue;
      result.push({
        key: `household:${h.id}`,
        label: h.name,
        sublabel: h.phone ? `${h.phone} · ${members.length} student${members.length === 1 ? '' : 's'}` : `${members.length} student${members.length === 1 ? '' : 's'}`,
        members: members.map((s) => ({
          studentId: s.id,
          name: `${s.last_name} ${s.first_name}`,
          classLabel: classLabel(s.current_class_arm_id),
          balance: balanceByStudent.get(s.id) ?? 0
        }))
      });
    }

    // Fallback: students not yet linked to a household whose own guardian
    // name/phone matches — surfaced individually so a search here never
    // comes up empty just because the phone-match at enrollment missed a
    // family. These aren't a "split" (only one child), but should still be
    // reachable from the same search.
    for (const s of students) {
      if (s.household_id) continue;
      const nameMatch = (s.guardian_name ?? '').toLowerCase().includes(q);
      const phoneMatch = qDigits.length >= 4 && normalizePhone(s.guardian_phone ?? '').includes(qDigits);
      if (!nameMatch && !phoneMatch) continue;
      result.push({
        key: `solo:${s.id}`,
        label: s.guardian_name || 'Guardian',
        sublabel: `${s.guardian_phone ?? 'no phone on file'} · not linked to a household`,
        members: [
          {
            studentId: s.id,
            name: `${s.last_name} ${s.first_name}`,
            classLabel: classLabel(s.current_class_arm_id),
            balance: balanceByStudent.get(s.id) ?? 0
          }
        ]
      });
    }

    return result;
  }, [search, households, students, classLabel, balanceByStudent]);

  const selectedGroup = groups.find((g) => g.key === selectedGroupKey) ?? null;

  // Reconciliation view: past transactions touching this household, so
  // "what did the father's ₦20,000 last week actually cover" has one place
  // to look, rather than piecing it together from each child's own page.
  // Includes single-child transactions too (recorded from a student's own
  // profile), not just ones split here — anything touching this household.
  const householdTransactions = useMemo(() => {
    if (!selectedGroup) return [];
    const memberIds = new Set(selectedGroup.members.map((m) => m.studentId));
    const relevant = allPayments.filter((p) => p.household_transaction_id && memberIds.has(p.student_id));

    const byTxn = new Map<
      string,
      {
        txnId: string;
        date: string;
        method: string;
        receiptNumber: string | null;
        createdAt: string;
        byChild: Map<string, { name: string; amount: number }>;
      }
    >();

    for (const p of relevant) {
      const key = p.household_transaction_id!;
      let group = byTxn.get(key);
      if (!group) {
        group = {
          txnId: key,
          date: p.date_paid,
          method: p.method,
          receiptNumber: p.receipt_number,
          createdAt: p.created_at,
          byChild: new Map()
        };
        byTxn.set(key, group);
      }
      const s = allStudentsMap.get(p.student_id);
      const name = s ? `${s.last_name} ${s.first_name}` : 'Unknown student';
      const existing = group.byChild.get(p.student_id) ?? { name, amount: 0 };
      existing.amount += p.amount_paid;
      group.byChild.set(p.student_id, existing);
    }

    return Array.from(byTxn.values())
      .map((g) => ({
        ...g,
        total: Array.from(g.byChild.values()).reduce((sum, c) => sum + c.amount, 0),
        children: Array.from(g.byChild.values())
      }))
      .filter((g) => g.total !== 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [selectedGroup, allPayments, allStudentsMap]);

  const [expandedTxns, setExpandedTxns] = useState<Set<string>>(new Set());
  const toggleTxn = (id: string) =>
    setExpandedTxns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [totalAmount, setTotalAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptNumber, setReceiptNumber] = useState('');
  const [splits, setSplits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function selectGroup(g: Group) {
    setSelectedGroupKey(g.key);
    setSplits({});
    setTotalAmount('');
    setError(null);
    setSuccess(null);
  }

  const totalOwed = selectedGroup ? selectedGroup.members.reduce((sum, m) => sum + m.balance, 0) : 0;
  const total = Number(totalAmount) || 0;
  const allocated = Object.values(splits).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const remaining = total - allocated;

  function suggestSplit() {
    if (!selectedGroup || total <= 0) return;
    const next: Record<string, string> = {};
    let left = total;
    selectedGroup.members.forEach((m, idx) => {
      const isLast = idx === selectedGroup.members.length - 1;
      let share: number;
      if (isLast) {
        share = Math.max(0, Math.min(left, m.balance));
      } else {
        share = totalOwed > 0 ? Math.round(total * (m.balance / totalOwed)) : 0;
        share = Math.max(0, Math.min(share, m.balance, left));
      }
      next[m.studentId] = share > 0 ? String(share) : '';
      left -= share;
    });
    setSplits(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedGroup) return;
    if (!total || total <= 0) {
      setError('Enter the total amount received.');
      return;
    }
    if (total > totalOwed) {
      setError(`Amount exceeds this household's total outstanding balance (₦${totalOwed.toLocaleString()}).`);
      return;
    }
    if (remaining !== 0) {
      setError(
        remaining > 0
          ? `₦${remaining.toLocaleString()} of the total hasn't been assigned to a child yet.`
          : `₦${Math.abs(remaining).toLocaleString()} more has been assigned than the total received.`
      );
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

      const perChildAllocations = selectedGroup.members
        .map((m) => ({
          studentId: m.studentId,
          amount: Number(splits[m.studentId]) || 0
        }))
        .filter((a) => a.amount > 0)
        .map((a) => ({
          ...a,
          allocations: allocateOldestFirst(chargeBalances, a.studentId, a.amount)
        }));

      await db.writeTransaction(async (tx) => {
        for (const child of perChildAllocations) {
          for (const alloc of child.allocations) {
            await tx.execute(
              `INSERT INTO payments
                 (id, school_id, student_id, charge_id, amount_paid, date_paid, method, receipt_number, recorded_by,
                  household_transaction_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(),
                account.school_id,
                child.studentId,
                alloc.chargeId,
                alloc.amount,
                date,
                method,
                receiptNumber.trim() || null,
                account.id,
                transactionId,
                now
              ]
            );
          }
        }
      });

      setSuccess(
        `₦${total.toLocaleString()} recorded across ${perChildAllocations.length} student${perChildAllocations.length === 1 ? '' : 's'}.`
      );
      setTotalAmount('');
      setSplits({});
      setReceiptNumber('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
      <h1 style={{ marginBottom: 2 }}>Household payment</h1>
      <p style={{ color: '#64748b', margin: 0 }}>
        For a guardian paying for more than one child at once. Search by guardian name or phone, then split the
        total across their children — each still gets their own payment records against their own charges.
      </p>

      <input
        placeholder="Search by guardian name or phone"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setSelectedGroupKey(null);
        }}
        style={{ width: '100%', margin: '1.25rem 0 0.5rem' }}
      />

      {search.trim() && !selectedGroup && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          {groups.length === 0 ? (
            <div style={{ padding: 14, color: '#64748b', fontSize: 13 }}>
              No match. If this family has more than one child here, link them from either student's profile first
              (Household section).
            </div>
          ) : (
            groups.map((g) => (
              <div
                key={g.key}
                onClick={() => selectGroup(g)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid #eee',
                  cursor: 'pointer',
                  fontSize: 13
                }}
              >
                <div style={{ fontWeight: 600 }}>{g.label}</div>
                <div style={{ fontSize: 11.5, color: '#64748b' }}>{g.sublabel}</div>
              </div>
            ))
          )}
        </div>
      )}

      {selectedGroup && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10
            }}
          >
            <div>
              <strong>{selectedGroup.label}</strong>
              <span style={{ color: '#64748b', fontSize: 12 }}> · {selectedGroup.sublabel}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedGroupKey(null);
                setSearch('');
              }}
            >
              Change
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ maxWidth: 'none', margin: 0 }}>
            <input
              type="number"
              placeholder="Total amount received"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              required
            />
            <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              <option value="cash">Cash</option>
              <option value="bank-transfer">Bank transfer</option>
              <option value="pos">POS</option>
              <option value="other">Other</option>
            </select>
            <label style={{ fontSize: 12, color: '#888' }}>Date paid</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input
              placeholder="Receipt number (optional)"
              value={receiptNumber}
              onChange={(e) => setReceiptNumber(e.target.value)}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.75rem 0 0.25rem' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Split across children</span>
              <button type="button" onClick={suggestSplit} disabled={total <= 0}>
                Suggest split by balance
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12 }}>
                  <th style={{ padding: 6 }}>Student</th>
                  <th style={{ padding: 6 }}>Owes</th>
                  <th style={{ padding: 6 }}>This payment</th>
                </tr>
              </thead>
              <tbody>
                {selectedGroup.members.map((m) => (
                  <tr key={m.studentId} style={{ borderBottom: '1px solid #eee', fontSize: 13 }}>
                    <td style={{ padding: 6 }}>
                      <Link to={`/students/${m.studentId}`}>{m.name}</Link>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{m.classLabel}</div>
                    </td>
                    <td style={{ padding: 6, color: m.balance > 0 ? 'crimson' : 'inherit' }}>
                      ₦{m.balance.toLocaleString()}
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        value={splits[m.studentId] ?? ''}
                        onChange={(e) => setSplits((prev) => ({ ...prev, [m.studentId]: e.target.value }))}
                        style={{ width: 110 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontSize: 12, color: remaining === 0 ? '#3A7D5C' : '#64748b' }}>
              {total > 0
                ? remaining === 0
                  ? 'Fully allocated.'
                  : remaining > 0
                    ? `₦${remaining.toLocaleString()} left to assign.`
                    : `₦${Math.abs(remaining).toLocaleString()} over the total received.`
                : 'Enter the total amount received above.'}
            </p>

            <button type="submit" disabled={saving}>
              {saving ? 'Recording…' : 'Record household payment'}
            </button>
            {error && <p style={{ color: 'crimson' }}>{error}</p>}
            {success && <p style={{ color: 'green' }}>{success}</p>}
          </form>

          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: 15 }}>Recent household payments</h2>
            <p style={{ fontSize: 12, color: '#64748b' }}>
              Every recorded transaction touching this household, so a total received (e.g. one ₦20,000 handed over
              in person) can be matched back to how it was split — this reconciles against a receipt book or bank
              statement one line at a time, not one line per child.
            </p>
            {householdTransactions.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#888' }}>No payments recorded for this household yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12 }}>
                    <th style={{ padding: 6 }}>Date</th>
                    <th style={{ padding: 6 }}>Total received</th>
                    <th style={{ padding: 6 }}>Method</th>
                    <th style={{ padding: 6 }}>Receipt #</th>
                    <th style={{ padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {householdTransactions.map((t) => (
                    <Fragment key={t.txnId}>
                      <tr style={{ borderBottom: '1px solid #eee', fontSize: 13 }}>
                        <td style={{ padding: 6 }}>{t.date}</td>
                        <td style={{ padding: 6, fontWeight: 600 }}>
                          ₦{t.total.toLocaleString()}
                          {t.children.length > 1 && (
                            <span style={{ color: '#888', fontWeight: 400 }}> ({t.children.length} children)</span>
                          )}
                        </td>
                        <td style={{ padding: 6 }}>{t.method}</td>
                        <td style={{ padding: 6 }}>{t.receiptNumber ?? '—'}</td>
                        <td style={{ padding: 6 }}>
                          {t.children.length > 1 && (
                            <button onClick={() => toggleTxn(t.txnId)} style={{ fontSize: 11 }}>
                              {expandedTxns.has(t.txnId) ? 'Hide breakdown' : 'Show breakdown'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {t.children.length > 1 && expandedTxns.has(t.txnId) && (
                        <tr>
                          <td colSpan={5} style={{ padding: '0 6px 8px 24px' }}>
                            {t.children.map((c) => (
                              <div key={c.name} style={{ fontSize: 12, color: '#555', padding: '2px 0' }}>
                                {c.name} — ₦{c.amount.toLocaleString()}
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
