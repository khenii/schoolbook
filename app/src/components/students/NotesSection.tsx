import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';

interface NoteRow {
  id: string;
  text: string;
  created_by: string | null;
  pinned: number;
  archived: number;
  created_at: string;
}

interface AccountRow {
  id: string;
  email: string;
}

// "notes-box" from 05-student-profile.html. student_notes is the one table
// that allows UPDATE (pin/archive toggle) rather than being append-only, so
// there's deliberately no hard delete here — the mockup's "✕ remove" icon
// maps to archive (semantically closest: it takes the note out of the
// pinned view without destroying the record).
export default function NotesSection({ studentId }: { studentId: string }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: notes } = useQuery<NoteRow>(
    'SELECT * FROM student_notes WHERE student_id = ? ORDER BY created_at DESC',
    [studentId]
  );
  const { data: accounts } = useQuery<AccountRow>('SELECT id, email FROM accounts');

  const authorLabel = (createdBy: string | null) => accounts.find((a) => a.id === createdBy)?.email ?? 'Unknown';

  const pinnedNotes = notes.filter((n) => n.pinned && !n.archived);
  const otherNotes = notes.filter((n) => !n.pinned || n.archived);

  const [text, setText] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const [saving, setSaving] = useState(false);

  async function addNote() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await db.execute(
        'INSERT INTO student_notes (id, school_id, student_id, text, created_by, pinned, archived, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?)',
        [crypto.randomUUID(), schoolId, studentId, trimmed, account.id, new Date().toISOString()]
      );
      setText('');
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchived(note: NoteRow) {
    await db.execute('UPDATE student_notes SET archived = ? WHERE id = ?', [note.archived ? 0 : 1, note.id]);
  }

  return (
    <div className="notes-box">
      {pinnedNotes.length === 0 ? (
        <div className="no-notes">No pinned notes for this student yet.</div>
      ) : (
        pinnedNotes.map((n) => (
          <div className="note-card" key={n.id}>
            <div className="note-pin">📌</div>
            <div className="note-body">
              <div className="note-text">{n.text}</div>
              <div className="note-meta">
                {authorLabel(n.created_by)} · {new Date(n.created_at).toLocaleDateString()}
              </div>
            </div>
            <div className="note-remove" onClick={() => toggleArchived(n)} title="Archive this note">
              ✕
            </div>
          </div>
        ))
      )}
      <div className="add-note-row">
        <input
          type="text"
          placeholder="Pin a note — e.g. sibling discount, payment plan, special arrangement…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addNote()}
        />
        <button onClick={addNote} disabled={saving || !text.trim()}>
          Pin note
        </button>
      </div>

      {otherNotes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <span className="mini-btn" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? 'Hide' : 'Show'} archived notes ({otherNotes.length})
          </span>
          {showOthers &&
            otherNotes.map((n) => (
              <div className="note-card" key={n.id} style={{ background: 'var(--paper)', borderColor: 'var(--line)', opacity: 0.8 }}>
                <div className="note-pin" style={{ color: 'var(--slate-soft)' }}>
                  📎
                </div>
                <div className="note-body">
                  <div className="note-text">{n.text}</div>
                  <div className="note-meta" style={{ color: 'var(--slate-soft)' }}>
                    {authorLabel(n.created_by)} · {new Date(n.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="note-remove" onClick={() => toggleArchived(n)} title="Unarchive / re-pin">
                  ↺
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
