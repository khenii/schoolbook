import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';

interface ClassLevel {
  id: string;
  name: string;
  sort_order: number;
}

interface ClassArm {
  id: string;
  class_level_id: string;
  name: string;
}

export default function ClassesArmsTab({ activeSessionId }: { activeSessionId: string }) {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: levels } = useQuery<ClassLevel>('SELECT * FROM class_levels ORDER BY sort_order ASC');
  const { data: arms } = useQuery<ClassArm>('SELECT * FROM class_arms WHERE session_id = ? ORDER BY name ASC', [
    activeSessionId
  ]);

  const [openLevelId, setOpenLevelId] = useState<string | null>(null);
  const [newArmName, setNewArmName] = useState<Record<string, string>>({});
  const [newLevelName, setNewLevelName] = useState('');
  const [addingLevel, setAddingLevel] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const sortedLevels = [...levels].sort((a, b) => a.sort_order - b.sort_order);
  const armsByLevel = (levelId: string) => arms.filter((a) => a.class_level_id === levelId);

  async function addLevel() {
    const name = newLevelName.trim();
    if (!name) return;
    const nextOrder = levels.length;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO class_levels (id, school_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, schoolId, name, nextOrder, now]
    );
    setNewLevelName('');
    setAddingLevel(false);
  }

  async function renameLevel(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    await db.execute('UPDATE class_levels SET name = ? WHERE id = ?', [name, id]);
    setRenamingId(null);
  }

  async function removeLevel(id: string) {
    const hasArms = armsByLevel(id).length > 0;
    if (hasArms && !confirm('This level has arms configured. Remove it and its arms anyway?')) return;
    await db.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM class_arms WHERE class_level_id = ?', [id]);
      await tx.execute('DELETE FROM class_levels WHERE id = ?', [id]);
    });
  }

  async function moveLevel(id: string, direction: -1 | 1) {
    const idx = sortedLevels.findIndex((l) => l.id === id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sortedLevels.length) return;
    const a = sortedLevels[idx];
    const b = sortedLevels[swapIdx];
    await db.writeTransaction(async (tx) => {
      await tx.execute('UPDATE class_levels SET sort_order = ? WHERE id = ?', [b.sort_order, a.id]);
      await tx.execute('UPDATE class_levels SET sort_order = ? WHERE id = ?', [a.sort_order, b.id]);
    });
  }

  async function addArm(levelId: string) {
    const name = (newArmName[levelId] ?? '').trim().toUpperCase();
    if (!name) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO class_arms (id, school_id, class_level_id, session_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, schoolId, levelId, activeSessionId, name, now]
    );
    setNewArmName((prev) => ({ ...prev, [levelId]: '' }));
  }

  async function removeArm(id: string) {
    await db.execute('DELETE FROM class_arms WHERE id = ?', [id]);
  }

  return (
    <div>
      <p style={{ color: 'var(--color-slate)', fontSize: 13 }}>
        Add arms to any class level — e.g. split SS3 into A, B, C. Levels with no arms yet use a single default
        section.
      </p>

      {sortedLevels.map((level, idx) => {
        const levelArms = armsByLevel(level.id);
        const isOpen = openLevelId === level.id;
        return (
          <div key={level.id} style={{ border: '1px solid #ddd', borderRadius: 8, marginBottom: 10, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => moveLevel(level.id, -1)} disabled={idx === 0} title="Move up">
                ↑
              </button>
              <button
                onClick={() => moveLevel(level.id, 1)}
                disabled={idx === sortedLevels.length - 1}
                title="Move down"
              >
                ↓
              </button>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpenLevelId(isOpen ? null : level.id)}>
                {renamingId === level.id ? (
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => renameLevel(level.id)}
                    onKeyDown={(e) => e.key === 'Enter' && renameLevel(level.id)}
                    autoFocus
                  />
                ) : (
                  <strong>{level.name}</strong>
                )}
                <span style={{ color: '#888', marginLeft: 8, fontSize: 12 }}>
                  {levelArms.length} arm{levelArms.length !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(level.id);
                  setRenameValue(level.name);
                }}
              >
                Rename
              </button>
              <button onClick={() => removeLevel(level.id)} style={{ color: 'crimson' }}>
                Remove
              </button>
            </div>

            {isOpen && (
              <div style={{ marginTop: 12, paddingLeft: 24 }}>
                {levelArms.map((arm) => (
                  <div key={arm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                    <span>
                      {level.name} {arm.name}
                    </span>
                    <button onClick={() => removeArm(arm.id)} style={{ marginLeft: 'auto', color: 'crimson' }}>
                      ✕
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input
                    placeholder="New arm name, e.g. D"
                    value={newArmName[level.id] ?? ''}
                    onChange={(e) => setNewArmName((prev) => ({ ...prev, [level.id]: e.target.value }))}
                  />
                  <button onClick={() => addArm(level.id)}>Add arm</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {addingLevel ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Class level name, e.g. Creche"
            value={newLevelName}
            onChange={(e) => setNewLevelName(e.target.value)}
            autoFocus
          />
          <button onClick={addLevel}>Add</button>
          <button
            onClick={() => {
              setAddingLevel(false);
              setNewLevelName('');
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div
          onClick={() => setAddingLevel(true)}
          style={{ border: '1.5px dashed #ccc', borderRadius: 8, padding: 12, cursor: 'pointer', color: '#888' }}
        >
          + Add another class level
        </div>
      )}
    </div>
  );
}
