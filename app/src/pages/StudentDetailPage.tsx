import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { usePowerSync, useQuery } from '@powersync/react';
import AppShell from '../components/AppShell';
import { useAppContext } from '../lib/AppContext';
import { useStudentLedger } from '../hooks/useStudentLedger';
import HouseholdSection from '../components/students/HouseholdSection';
import NotesSection from '../components/students/NotesSection';
import PaymentHistorySection from '../components/students/PaymentHistorySection';
import DiscountsSection from '../components/students/DiscountsSection';
import { ExitPanel, InactiveBanner } from '../components/students/ExitSection';
import RecordPaymentPanel from '../components/students/RecordPaymentPanel';
import WriteOffPanel from '../components/students/WriteOffPanel';
import AcademicHistory from '../components/students/AcademicHistory';
import type { WriteOffTarget } from '../components/students/WriteOffPanel';
import { logAudit } from '../lib/auditLog';

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  admission_number: string;
  status: string;
  date_of_birth: string | null;
  gender: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  address: string | null;
  current_class_arm_id: string | null;
  household_id: string | null;
  status_changed_at: string | null;
  status_reason: string | null;
}

interface ClassArmRow {
  id: string;
  class_level_id: string;
  name: string;
}

interface ClassLevelRow {
  id: string;
  name: string;
}

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '—';
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const db = usePowerSync();
  const { account } = useAppContext();
  const studentId = id ?? '';

  const { data: studentRows } = useQuery<StudentRow>('SELECT * FROM students WHERE id = ?', [studentId]);
  const student = studentRows[0];

  const { data: arms } = useQuery<ClassArmRow>('SELECT id, class_level_id, name FROM class_arms');
  const { data: levels } = useQuery<ClassLevelRow>('SELECT id, name FROM class_levels');
  const {
    charges,
    payments,
    writeOffs,
    currentTermId,
    currentSessionId,
    currentTermCharges,
    currentTermBalance,
    paidThisTerm,
    paymentsThisTermCount,
    arrears,
    totalArrears
  } = useStudentLedger(studentId);

  const [editForm, setEditForm] = useState<Partial<StudentRow>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [paymentPanelOpen, setPaymentPanelOpen] = useState(false);
  const [exitPanelOpen, setExitPanelOpen] = useState(false);
  const [writeOffTarget, setWriteOffTarget] = useState<WriteOffTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (student) setEditForm(student);
  }, [student?.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function notify(msg: string) {
    setToast(msg);
  }

  const armLabel = (armId: string | null) => {
    if (!armId) return '—';
    const arm = arms.find((a) => a.id === armId);
    if (!arm) return '—';
    const level = levels.find((l) => l.id === arm.class_level_id);
    return `${level?.name ?? ''} ${arm.name}`.trim();
  };

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    if (!student) return;
    setEditSaving(true);
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `UPDATE students SET
           first_name = ?, last_name = ?, other_names = ?, guardian_name = ?, guardian_phone = ?,
           address = ?, gender = ?, date_of_birth = ?, status = ?
         WHERE id = ?`,
        [
          editForm.first_name ?? student.first_name,
          editForm.last_name ?? student.last_name,
          editForm.other_names ?? null,
          editForm.guardian_name ?? null,
          editForm.guardian_phone ?? null,
          editForm.address ?? null,
          editForm.gender ?? null,
          editForm.date_of_birth ?? null,
          editForm.status ?? student.status,
          student.id
        ]
      );
      await logAudit(tx, {
        schoolId: account.school_id,
        actorId: account.id,
        action: 'student.updated',
        entityType: 'student',
        entityId: student.id,
        metadata: { name: `${editForm.last_name ?? student.last_name} ${editForm.first_name ?? student.first_name}` }
      });
    });
    setEditSaving(false);
    setEditPanelOpen(false);
    notify('Student details updated');
  }

  if (!student) {
    return (
      <AppShell title="Students" pageClass="page-students">
        <p style={{ color: 'var(--slate-soft)' }}>Loading, or this student doesn't exist.</p>
      </AppShell>
    );
  }

  const isActive = student.status === 'new' || student.status === 'existing';

  return (
    <AppShell
      crumb={{ label: 'Students', to: '/students', current: `${student.first_name} ${student.last_name}` }}
      pageClass="page-profile"
    >
      {!isActive && <InactiveBanner student={student} />}

      <div className="profile-head">
        <div className="big-avatar">{initials(student.first_name, student.last_name)}</div>
        <div className="profile-info">
          <h2>
            {student.first_name} {student.last_name}
          </h2>
          <div className="profile-meta">
            {student.status === 'new' && <span className="status-tag new">NEW</span>}
            {student.status === 'existing' && <span className="status-tag existing">EXISTING</span>}
            {student.status === 'withdrawn' && <span className="status-tag withdrawn">WITHDRAWN</span>}
            {student.status === 'graduated' && <span className="status-tag graduated">GRADUATED</span>}
            <span className="class-tag">{armLabel(student.current_class_arm_id)}</span>
            <span>{student.admission_number}</span>
            {student.guardian_phone && (
              <>
                <span>·</span>
                <span>Guardian: {student.guardian_phone}</span>
              </>
            )}
          </div>
        </div>
        <div className="profile-actions">
          {isActive && (
            <button
              className="btn-ghost"
              style={{ color: 'var(--rust)', borderColor: 'var(--rust-bg)' }}
              onClick={() => setExitPanelOpen(true)}
            >
              Withdraw student
            </button>
          )}
          <button className="btn-ghost" onClick={() => setEditPanelOpen(true)}>
            Edit student
          </button>
          <button className="btn-primary" onClick={() => setPaymentPanelOpen(true)}>
            Record payment
          </button>
        </div>
      </div>

      <HouseholdSection student={student} />
      <NotesSection studentId={student.id} />

      <div className="stat-row">
        <div className="stat-card warn">
          <div className="label">Current term balance</div>
          <div className="value">₦{currentTermBalance.toLocaleString()}</div>
          <div className="sub">{armLabel(student.current_class_arm_id)}</div>
        </div>
        <div className="stat-card warn">
          <div className="label">Total arrears (all sessions)</div>
          <div className="value">₦{totalArrears.toLocaleString()}</div>
          <div className="sub">{arrears.length === 0 ? 'None outstanding' : 'Carried from earlier terms — see below'}</div>
        </div>
        <div className="stat-card ok">
          <div className="label">Paid this term so far</div>
          <div className="value">₦{paidThisTerm.toLocaleString()}</div>
          <div className="sub">
            {paymentsThisTermCount} payment{paymentsThisTermCount === 1 ? '' : 's'} recorded
          </div>
        </div>
      </div>

      {totalArrears > 0 && (
        <div className="section">
          <div className="section-title">
            <div>
              <h3>Outstanding arrears from previous terms</h3>
              <p>These balances were never cleared and carried forward — they don't disappear when a student is promoted.</p>
            </div>
          </div>
          <div className="arrears-box">
            <div className="arrears-banner">⚠ This student has unpaid balances from a previous session</div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <div className="t-row head">
                <div className="col-term">Session / Term</div>
                <div className="col-fee">Fee item</div>
                <div className="col-amt">Charged</div>
                <div className="col-amt">Paid</div>
                <div className="col-status">Balance</div>
              </div>
              {arrears.map((c) => (
                <div className="t-row" key={c.id}>
                  <div className="col-term">
                    <div className="t">{c.classLevelName}</div>
                    <div className="s">
                      {c.sessionName} · {c.termName}
                    </div>
                  </div>
                  <div className="col-fee">{c.feeItemName}</div>
                  <div className="col-amt">₦{c.amount_expected.toLocaleString()}</div>
                  <div className="col-amt">₦{c.paid.toLocaleString()}</div>
                  <div className="col-status">
                    <span className="bal-tag owed">₦{c.balance.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <DiscountsSection studentId={student.id} />

      <div className="section">
        <div className="section-title">
          <div>
            <h3>This term's charges</h3>
            <p>{armLabel(student.current_class_arm_id)}</p>
          </div>
        </div>
        <div className="table-wrap">
          <div className="t-row head">
            <div className="col-fee">Fee item</div>
            <div className="col-amt">Charged</div>
            <div className="col-amt">Paid</div>
            <div className="col-status">Balance</div>
            <div className="col-action-btn" style={{ flex: 1 }} />
          </div>
          {currentTermCharges.length === 0 ? (
            <div className="empty-note">No charges for the current term yet.</div>
          ) : (
            currentTermCharges.map((c) => (
              <div className="t-row" key={c.id}>
                <div className="col-fee">{c.feeItemName}</div>
                <div className="col-amt">₦{c.amount_expected.toLocaleString()}</div>
                <div className="col-amt">₦{c.paid.toLocaleString()}</div>
                <div className="col-status">
                  {c.balance > 0 ? (
                    <span className="bal-tag owed">₦{c.balance.toLocaleString()}</span>
                  ) : c.writtenOff > 0 ? (
                    <span className="bal-tag writtenoff">WRITTEN OFF</span>
                  ) : (
                    <span className="bal-tag clear">Cleared</span>
                  )}
                </div>
                <div className="col-action-btn" style={{ flex: 1 }}>
                  {c.balance > 0 && (
                    <>
                      <span className="mini-btn" onClick={() => setPaymentPanelOpen(true)}>
                        Pay →
                      </span>
                      <span
                        className="writeoff-btn"
                        onClick={() => setWriteOffTarget({ chargeId: c.id, feeItemName: c.feeItemName, balance: c.balance })}
                      >
                        Write off
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {writeOffs.length > 0 && (
        <div className="section">
          <div className="section-title">
            <div>
              <h3>Write-offs on this record</h3>
              <p>A permanent record of any balance forgiven — never editable or deletable once recorded.</p>
            </div>
          </div>
          <div className="table-wrap" style={{ borderColor: 'var(--gold-soft)' }}>
            {writeOffs.map((w) => {
              const c = charges.find((x) => x.id === w.charge_id);
              return (
                <div className="wo-row" key={w.id}>
                  <div className="wo-icon">📝</div>
                  <div className="wo-body">
                    <div className="wo-top">
                      <div className="wo-fee">{c?.feeItemName ?? 'Charge'}</div>
                      <div className="wo-amt">₦{w.amount.toLocaleString()} written off</div>
                    </div>
                    <div className="wo-reason">"{w.reason}"</div>
                    <div className="wo-meta">{new Date(w.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">
          <div>
            <h3>Recent payments</h3>
            <p>The last few payments recorded, most recent first.</p>
          </div>
        </div>
        <PaymentHistorySection studentId={student.id} />
      </div>

      <div className="section">
        <div className="section-title">
          <div>
            <h3>Full academic history</h3>
            <p>Every session this student has been enrolled — collapsed by default so it stays readable at scale.</p>
          </div>
        </div>
        <AcademicHistory
          charges={charges}
          payments={payments}
          currentTermId={currentTermId}
          currentSessionId={currentSessionId}
        />
      </div>

      <RecordPaymentPanel
        open={paymentPanelOpen}
        onClose={() => setPaymentPanelOpen(false)}
        studentId={student.id}
        studentName={`${student.first_name} ${student.last_name}`}
        classLabel={armLabel(student.current_class_arm_id)}
        onSaved={(msg) => {
          setPaymentPanelOpen(false);
          notify(msg);
        }}
      />

      <WriteOffPanel
        target={writeOffTarget}
        onClose={() => setWriteOffTarget(null)}
        studentId={student.id}
        onSaved={(msg) => {
          setWriteOffTarget(null);
          notify(msg);
        }}
      />

      <ExitPanel
        open={exitPanelOpen}
        onClose={() => setExitPanelOpen(false)}
        student={student}
        onSaved={(msg) => {
          setExitPanelOpen(false);
          notify(msg);
        }}
      />

      {/* EDIT STUDENT PANEL — no dedicated mockup; styled to match the same
          slide-over family as the others above. */}
      <div className={`overlay${editPanelOpen ? ' show' : ''}`} onClick={() => setEditPanelOpen(false)} />
      <div className={`panel${editPanelOpen ? ' show' : ''}`}>
        <div className="panel-head">
          <div>
            <h3>Edit student</h3>
            <p>Bio-data and guardian details.</p>
          </div>
          <div className="panel-close" onClick={() => setEditPanelOpen(false)}>
            ✕
          </div>
        </div>
        <form onSubmit={handleEditSave}>
          <div className="panel-body">
            <div className="field-row">
              <div className="field">
                <label>First name</label>
                <input
                  value={editForm.first_name ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Last name</label>
                <input
                  value={editForm.last_name ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label>Other names</label>
              <input
                value={editForm.other_names ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, other_names: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Status</label>
              <select
                value={editForm.status ?? student.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="new">New</option>
                <option value="existing">Existing</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="graduated">Graduated</option>
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Date of birth</label>
                <input
                  type="date"
                  value={editForm.date_of_birth ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, date_of_birth: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Gender</label>
                <input value={editForm.gender ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, gender: e.target.value }))} />
              </div>
            </div>
            <div className="field">
              <label>Guardian name</label>
              <input
                value={editForm.guardian_name ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, guardian_name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Guardian phone</label>
              <input
                value={editForm.guardian_phone ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, guardian_phone: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Address</label>
              <input value={editForm.address ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
          </div>
          <div className="panel-foot">
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </AppShell>
  );
}
