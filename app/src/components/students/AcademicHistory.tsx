import { useMemo, useState } from 'react';
import { useStudentLedger } from '../../hooks/useStudentLedger';

type LedgerCharge = ReturnType<typeof useStudentLedger>['charges'][number];
type PaymentRow = ReturnType<typeof useStudentLedger>['payments'][number];

interface TermGroup {
  termId: string;
  termName: string;
  sortKey: string;
  charged: number;
  paid: number;
  writtenOff: number;
  chargeIds: string[];
}

interface SessionGroup {
  sessionId: string;
  sessionName: string;
  sortKey: string;
  isCurrent: boolean;
  hasArrears: boolean;
  charged: number;
  paid: number;
  balance: number;
  terms: TermGroup[];
}

// "Full academic history" accordion from 05-student-profile.html — every
// session/term this student has ever had a charge in, collapsed by
// default except the current session and any session still carrying
// arrears, so it stays readable at scale (a student with 12 years on file
// shouldn't dump 36 term rows onto the page at once).
export default function AcademicHistory({
  charges,
  payments,
  currentTermId,
  currentSessionId
}: {
  charges: LedgerCharge[];
  payments: PaymentRow[];
  currentTermId: string | null;
  currentSessionId: string | null;
}) {
  const sessions = useMemo<SessionGroup[]>(() => {
    const sessionMap = new Map<
      string,
      { sessionName: string; sortKey: string; terms: Map<string, TermGroup>; classLabel: string }
    >();

    for (const c of charges) {
      let s = sessionMap.get(c.session_id);
      if (!s) {
        s = { sessionName: c.sessionName, sortKey: c.sortKey.split('__')[0], terms: new Map(), classLabel: c.classLevelName };
        sessionMap.set(c.session_id, s);
      }
      let t = s.terms.get(c.term_id);
      if (!t) {
        t = { termId: c.term_id, termName: c.termName, sortKey: c.sortKey, charged: 0, paid: 0, writtenOff: 0, chargeIds: [] };
        s.terms.set(c.term_id, t);
      }
      t.charged += c.amount_expected;
      t.paid += c.paid;
      t.writtenOff += c.writtenOff;
      t.chargeIds.push(c.id);
    }

    return Array.from(sessionMap.entries())
      .map(([sessionId, s]) => {
        const terms = Array.from(s.terms.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        const charged = terms.reduce((sum, t) => sum + t.charged, 0);
        const paid = terms.reduce((sum, t) => sum + t.paid, 0);
        const writtenOff = terms.reduce((sum, t) => sum + t.writtenOff, 0);
        const balance = charged - paid - writtenOff;
        const isCurrent = sessionId === currentSessionId;
        return {
          sessionId,
          sessionName: `${s.sessionName} · ${s.classLabel}`,
          sortKey: s.sortKey,
          isCurrent,
          hasArrears: balance > 0 && !isCurrent,
          charged,
          paid,
          balance,
          terms
        };
      })
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey)); // most recent first
  }, [charges, currentSessionId]);

  const paymentsByCharge = useMemo(() => {
    const map = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      if (p.amount_paid <= 0) continue;
      const list = map.get(p.charge_id) ?? [];
      list.push(p);
      map.set(p.charge_id, list);
    }
    return map;
  }, [payments]);

  const feeItemNameByCharge = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of charges) map.set(c.id, c.feeItemName);
    return map;
  }, [charges]);

  const [openSessions, setOpenSessions] = useState<Set<string>>(
    () => new Set(sessions.filter((s) => s.isCurrent || s.hasArrears).map((s) => s.sessionId))
  );
  const [openTerms, setOpenTerms] = useState<Set<string>>(
    () => new Set(sessions.flatMap((s) => s.terms.filter((t) => t.termId === currentTermId || t.charged - t.paid - t.writtenOff > 0).map((t) => `${s.sessionId}|${t.termId}`)))
  );

  function toggleSession(id: string) {
    setOpenSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTerm(key: string) {
    setOpenTerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const [jumpValue, setJumpValue] = useState('');
  function jumpToSession(sessionId: string) {
    if (!sessionId) return;
    setOpenSessions((prev) => new Set(prev).add(sessionId));
    setTimeout(() => {
      document.getElementById(`session-${sessionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  if (sessions.length === 0) {
    return <div className="empty-note">No academic history recorded yet.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <select
          id="jumpSession"
          value={jumpValue}
          onChange={(e) => {
            setJumpValue(e.target.value);
            jumpToSession(e.target.value);
          }}
        >
          <option value="">Jump to a session…</option>
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.sessionName}
            </option>
          ))}
        </select>
      </div>

      {sessions.map((s) => {
        const isOpen = openSessions.has(s.sessionId);
        return (
          <div
            key={s.sessionId}
            id={`session-${s.sessionId}`}
            className={`session-block${isOpen ? ' open' : ''}${s.hasArrears ? ' has-arrears' : ''}`}
          >
            <div className="session-header" onClick={() => toggleSession(s.sessionId)}>
              <div className="session-chevron">▸</div>
              <div className="session-title-block">
                <div className="s">
                  {s.sessionName}
                  {s.isCurrent && (
                    <span style={{ color: 'var(--gold)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>
                      {' '}
                      · CURRENT
                    </span>
                  )}
                </div>
              </div>
              <div className="session-totals">
                <div className="st">
                  <div className="lbl">Charged</div>
                  <div className="val">₦{s.charged.toLocaleString()}</div>
                </div>
                <div className="st">
                  <div className="lbl">Paid</div>
                  <div className="val">₦{s.paid.toLocaleString()}</div>
                </div>
              </div>
              {s.balance > 0 ? (
                <span className="session-bal-tag owed">₦{s.balance.toLocaleString()}</span>
              ) : (
                <span className="session-bal-tag clear">Cleared</span>
              )}
            </div>

            {isOpen && (
              <div className="session-body">
                {s.terms.map((t) => {
                  const tKey = `${s.sessionId}|${t.termId}`;
                  const tOpen = openTerms.has(tKey);
                  const tBal = t.charged - t.paid - t.writtenOff;
                  if (t.charged === 0) {
                    return (
                      <div className="term-row" style={{ cursor: 'default' }} key={t.termId}>
                        <div className="tname" style={{ color: 'var(--slate-soft)' }}>
                          {t.termName}
                        </div>
                        <div className="tamt">Not yet charged</div>
                        <div className="tbal" />
                      </div>
                    );
                  }
                  const receipts = t.chargeIds.flatMap((cid) =>
                    (paymentsByCharge.get(cid) ?? []).map((p) => ({ ...p, feeItemName: feeItemNameByCharge.get(cid) ?? '' }))
                  );
                  return (
                    <div key={t.termId}>
                      <div className={`term-row${tOpen ? ' open' : ''}`} onClick={() => toggleTerm(tKey)}>
                        <div className="tname">{t.termName}</div>
                        <div className="tamt">
                          ₦{t.paid.toLocaleString()} / ₦{t.charged.toLocaleString()}
                        </div>
                        <div className="tbal">
                          {tBal > 0 ? (
                            <span className="session-bal-tag owed">₦{tBal.toLocaleString()}</span>
                          ) : (
                            <span className="session-bal-tag clear">Cleared</span>
                          )}
                        </div>
                      </div>
                      {tOpen && (
                        <div className="term-detail">
                          {receipts.length > 0 ? (
                            receipts.map((r) => (
                              <div className="receipt-line" key={r.id}>
                                <div>
                                  <span className="rf">{r.feeItemName}</span>{' '}
                                  <span className="rd">
                                    · {r.method} · {r.receipt_number ?? '—'}
                                  </span>
                                </div>
                                <div className="ra">
                                  ₦{r.amount_paid.toLocaleString()} <span className="rd">{r.date_paid}</span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="no-balance-note">No payments recorded for this term.</div>
                          )}
                          {tBal > 0 && (
                            <div className="receipt-line">
                              <div className="rf" style={{ color: 'var(--rust)' }}>
                                Balance remaining
                              </div>
                              <div className="ra" style={{ color: 'var(--rust)' }}>
                                ₦{tBal.toLocaleString()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
