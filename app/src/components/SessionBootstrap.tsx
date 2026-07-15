import { useState } from 'react';
import { usePowerSync } from '@powersync/react';

export default function SessionBootstrap({
  schoolId,
  onComplete
}: {
  schoolId: string;
  onComplete: () => void;
}) {
  const db = usePowerSync();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const sessionId = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          'INSERT INTO sessions (id, school_id, name, is_active, created_at) VALUES (?, ?, ?, 1, ?)',
          [sessionId, schoolId, trimmed, now]
        );
        for (const termName of ['Term 1', 'Term 2', 'Term 3']) {
          const termId = crypto.randomUUID();
          await tx.execute(
            'INSERT INTO terms (id, school_id, session_id, name, created_at) VALUES (?, ?, ?, ?, ?)',
            [termId, schoolId, sessionId, termName, now]
          );
        }
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto' }}>
      <h1>Start your first academic session</h1>
      <p>e.g. "2025/2026". This creates the session and its 3 terms — exact dates can be set later.</p>
      <input placeholder="Session name" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={handleCreate} disabled={saving || !name.trim()}>
        {saving ? 'Creating…' : 'Create session'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}
