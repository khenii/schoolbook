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
  const [pinned, setPinned] = useState(true);
  const [showOthers, setShowOthers] = useState(false);
  const [saving, setSaving] = useState(false);

  async function addNote() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await db.execute(
        'INSERT INTO student_notes (id, school_id, student_id, text, created_by, pinned, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
        [crypto.randomUUID(), schoolId, studentId, trimmed, account.id, pinned ? 1 : 0, new Date().toISOString()]
      );
      setText('');
      setPinned(true);
    } finally {
      setSaving(false);
    }
  }

  async function togglePinned(note: NoteRow) {
    await db.execute('UPDATE student_notes SET pinned = ? WHERE id = ?', [note.pinned ? 0 : 1, note.id]);
  }

  async function toggleArchived(note: NoteRow) {
    await db.execute('UPDATE student_notes SET archived = ? WHERE id = ?', [note.archived ? 0 : 1, note.id]);
  }

  function NoteRowView({ note }: { note: NoteRow }) {
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, marginBottom: 8 }}>
        <p style={{ margin: 0 }}>{note.text}</p>
        <div style={{ fontSize: 11, color: '#888', marginTop: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>
            {authorLabel(note.created_by)} · {new Date(note.created_at).toLocaleDateString()}
          </span>
          <button onClick={() => togglePinned(note)} style={{ fontSize: 11 }}>
            {note.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button onClick={() => toggleArchived(note)} style={{ fontSize: 11 }}>
            {note.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: '1.5rem 0' }}>
      <h2 style={{ marginBottom: 8 }}>Notes</h2>

      {pinnedNotes.map((n) => (
        <NoteRowView key={n.id} note={n} />
      ))}
      {pinnedNotes.length === 0 && <p style={{ fontSize: 12.5, color: '#888' }}>No pinned notes.</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          placeholder="Add a note — e.g. a discount agreed verbally, a payment plan…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={addNote} disabled={saving || !text.trim()}>
          Add
        </button>
      </div>
      <label style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin this note (keeps
        it at the top)
      </label>

      {otherNotes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setShowOthers((v) => !v)} style={{ fontSize: 12 }}>
            {showOthers ? 'Hide' : 'Show'} unpinned/archived notes ({otherNotes.length})
          </button>
          {showOthers && (
            <div style={{ marginTop: 8 }}>
              {otherNotes.map((n) => (
                <NoteRowView key={n.id} note={n} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
