import { useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { DEFAULT_CLASS_LEVELS } from '../lib/defaultClassLevels';
import OnboardingLayout from './OnboardingLayout';
import StepTrack from './onboarding/StepTrack';

interface LevelDraft {
  name: string;
  order: number;
  checked: boolean;
}

// Step 3 — "Confirm your class levels" from 01-onboarding.html, including
// the mockup's ability to add a custom level right here (the previous
// version of this screen only let you untick defaults, no custom-add —
// restored to match the mockup, since it's a real and easy win).
export default function ClassLevelSetup({
  schoolId,
  onComplete
}: {
  schoolId: string;
  onComplete: (levelCount: number) => void;
}) {
  const db = usePowerSync();
  const [levels, setLevels] = useState<LevelDraft[]>(
    DEFAULT_CLASS_LEVELS.map((name, i) => ({ name, order: i + 1, checked: true }))
  );
  const [newLevelName, setNewLevelName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(idx: number) {
    setLevels((prev) => prev.map((l, i) => (i === idx ? { ...l, checked: !l.checked } : l)));
  }

  function addLevel() {
    const name = newLevelName.trim();
    if (!name) return;
    setLevels((prev) => [...prev, { name, order: prev.length + 1, checked: true }]);
    setNewLevelName('');
  }

  const checkedCount = levels.filter((l) => l.checked).length;

  async function handleContinue() {
    if (checkedCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      const chosen = levels.filter((l) => l.checked);
      await db.writeTransaction(async (tx) => {
        for (let i = 0; i < chosen.length; i++) {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          await tx.execute(
            'INSERT INTO class_levels (id, school_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, schoolId, chosen[i].name, i, now]
          );
        }
      });
      onComplete(chosen.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingLayout>
      <StepTrack current={3} />
      <h2 className="form-title">Confirm your class levels</h2>
      <div className="level-note">
        We've pre-filled the standard Nigerian structure. Untick anything you don't run, or add a custom level below
        — you can always change this later in Settings.
      </div>

      <div className="level-list">
        {levels.map((lvl, idx) => (
          <div className={`level-item${lvl.checked ? '' : ' excluded'}`} key={`${lvl.name}-${idx}`}>
            <div className={`level-check${lvl.checked ? ' checked' : ''}`} onClick={() => toggle(idx)} />
            <div className="level-name">{lvl.name}</div>
            <div className="level-order">{String(lvl.order).padStart(2, '0')}</div>
          </div>
        ))}
      </div>

      <div className="add-level-row">
        <input
          type="text"
          placeholder="Add a custom class level…"
          value={newLevelName}
          onChange={(e) => setNewLevelName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addLevel()}
        />
        <button onClick={addLevel}>Add</button>
      </div>

      <button className="btn-primary" onClick={handleContinue} disabled={saving || checkedCount === 0}>
        {saving ? 'Saving…' : 'Continue'}
      </button>
      {error && (
        <p className="field-error" style={{ display: 'block' }}>
          {error}
        </p>
      )}
    </OnboardingLayout>
  );
}
