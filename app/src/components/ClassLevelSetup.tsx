import { useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { DEFAULT_CLASS_LEVELS } from '../lib/defaultClassLevels';

export default function ClassLevelSetup({
  schoolId,
  onComplete
}: {
  schoolId: string;
  onComplete: () => void;
}) {
  const db = usePowerSync();
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_CLASS_LEVELS));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  async function handleContinue() {
    setSaving(true);
    setError(null);
    try {
      const chosen = DEFAULT_CLASS_LEVELS.filter((name) => selected.has(name));
      await db.writeTransaction(async (tx) => {
        for (let i = 0; i < chosen.length; i++) {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          await tx.execute(
            'INSERT INTO class_levels (id, school_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, schoolId, chosen[i], i, now]
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
      <h1>Which class levels does your school run?</h1>
      <p>You can add custom levels, rename, or reorder these later in Settings.</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {DEFAULT_CLASS_LEVELS.map((name) => (
          <li key={name} style={{ padding: '0.25rem 0' }}>
            <label>
              <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} /> {name}
            </label>
          </li>
        ))}
      </ul>
      <button onClick={handleContinue} disabled={saving}>
        {saving ? 'Saving…' : 'Continue to dashboard'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}
