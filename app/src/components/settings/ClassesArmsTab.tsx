import { useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { useAppContext } from '../../lib/AppContext';
import { useActiveSession } from '../../hooks/useActiveSession';
import { logAudit } from '../../lib/auditLog';

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

interface SessionOption {
  id: string;
  name: string;
}

// The "level-card" / "arm-row" family from 09-settings.html. The mockup's
// version is a flat, single-session demo with fabricated "reported vs
// enrolled" capacity numbers that don't exist in the real schema — arms are
// genuinely session-scoped here (spec §3.9: a new session starts with no
// arms configured yet), and levels can be reordered/renamed/removed, none
// of which the mockup covers. Those real controls are folded into the
// level-head as small icon actions styled like the mockup's own
// .arm-remove, rather than left as bare buttons.
export default function ClassesArmsTab() {
  const db = usePowerSync();
  const { account } = useAppContext();
  const schoolId = account.school_id;

  const { data: sessions } = useQuery<SessionOption>('SELECT id, name FROM sessions ORDER BY name DESC');
  const { session: activeSession } = useActiveSession();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const viewingSessionId = selectedSessionId ?? activeSession?.id ?? sessions[0]?.id ?? null;

  const { data: levels } = useQuery<ClassLevel>('SELECT * FROM class_levels ORDER BY sort_order ASC');
  const { data: arms } = useQuery<ClassArm>(
    'SELECT * FROM class_arms WHERE session_id = ? ORDER BY name ASC',
    [viewingSessionId ?? '']
  );

  const [openLevelId, setOpenLevelId] = useState<string | null>(null);
  const [newArmName, setNewArmName] = useState<Record<string, string>>({});
  const [armError, setArmError] = useState<Record<string, string>>({});
  const [newLevelName, setNewLevelName] = useState('');
  const [addingLevel, setAddingLevel] = useState(false);
  const [addLevelError, setAddLevelError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const sortedLevels = [...levels].sort((a, b) => a.sort_order - b.sort_order);
  const armsByLevel = (levelId: string) => arms.filter((a) => a.class_level_id === levelId);

  async function addLevel() {
    const name = newLevelName.trim();
    if (!name) return;
    setAddLevelError(null);
    if (levels.some((l) => l.name.trim().toLowerCase() === name.toLowerCase())) {
      setAddLevelError(`"${name}" already exists.`);
      return;
    }
    const nextOrder = levels.length;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        'INSERT INTO class_levels (id, school_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, schoolId, name, nextOrder, now]
      );
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'class_level.added',
        entityType: 'class_level',
        entityId: id,
        metadata: { name }
      });
    });
    setNewLevelName('');
    setAddingLevel(false);
  }

  async function renameLevel(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    setRenameError(null);
    const collides = levels.some((l) => l.id !== id && l.name.trim().toLowerCase() === name.toLowerCase());
    if (collides) {
      setRenameError(`"${name}" already exists.`);
      return;
    }
    await db.execute('UPDATE class_levels SET name = ? WHERE id = ?', [name, id]);
    setRenamingId(null);
  }

  async function removeLevel(id: string) {
    const hasArms = armsByLevel(id).length > 0;
    if (hasArms && !confirm('This level has arms configured. Remove it and its arms anyway?')) return;
    const levelName = levels.find((l) => l.id === id)?.name;
    await db.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM class_arms WHERE class_level_id = ?', [id]);
      await tx.execute('DELETE FROM class_levels WHERE id = ?', [id]);
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'class_level.removed',
        entityType: 'class_level',
        entityId: id,
        metadata: { name: levelName }
      });
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
    if (!viewingSessionId) return;
    const name = (newArmName[levelId] ?? '').trim().toUpperCase();
    if (!name) return;
    setArmError((prev) => ({ ...prev, [levelId]: '' }));
    const collides = armsByLevel(levelId).some((a) => a.name.trim().toUpperCase() === name);
    if (collides) {
      setArmError((prev) => ({ ...prev, [levelId]: `Arm "${name}" already exists for this level.` }));
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        'INSERT INTO class_arms (id, school_id, class_level_id, session_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, schoolId, levelId, viewingSessionId, name, now]
      );
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'class_arm.added',
        entityType: 'class_arm',
        entityId: id,
        metadata: { name, levelId }
      });
    });
    setNewArmName((prev) => ({ ...prev, [levelId]: '' }));
  }

  async function removeArm(id: string) {
    const armName = arms.find((a) => a.id === id)?.name;
    await db.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM class_arms WHERE id = ?', [id]);
      await logAudit(tx, {
        schoolId,
        actorId: account.id,
        action: 'class_arm.removed',
        entityType: 'class_arm',
        entityId: id,
        metadata: { name: armName }
      });
    });
  }

  if (!viewingSessionId) {
    return (
      <div className="tab-subhead">
        <p>No sessions yet — add one in the Sessions tab first, then come back here to set up arms.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="tab-subhead">
        <div>
          <p>
            Add arms to any class level — e.g. split SS3 into A, B, C. Levels with no arms added yet will use a
            single default section.
          </p>
        </div>
        <select
          value={viewingSessionId}
          onChange={(e) => setSelectedSessionId(e.target.value)}
          style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, background: 'var(--paper-card)', color: 'var(--ink)' }}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              Viewing: {s.name}
              {activeSession?.id === s.id ? ' (active)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        {sortedLevels.map((level, idx) => {
          const levelArms = armsByLevel(level.id);
          const isOpen = openLevelId === level.id;
          return (
            <div className={`level-card${isOpen ? ' open' : ''}`} key={level.id}>
              <div className="level-head" onClick={() => setOpenLevelId(isOpen ? null : level.id)}>
                <div className="level-order-badge">{String(idx + 1).padStart(2, '0')}</div>
                <div className="level-title">
                  {renamingId === level.id ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input
                        value={renameValue}
                        onChange={(e) => {
                          setRenameValue(e.target.value);
                          setRenameError(null);
                        }}
                        onBlur={() => renameLevel(level.id)}
                        onKeyDown={(e) => e.key === 'Enter' && renameLevel(level.id)}
                        autoFocus
                        style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13.5 }}
                      />
                      {renameError && <div className="field-error" style={{ display: 'block' }}>{renameError}</div>}
                    </div>
                  ) : (
                    <div className="name">{level.name}</div>
                  )}
                  <div className="sub">
                    {levelArms.length} arm{levelArms.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="arm-tags">
                  {levelArms.map((a) => (
                    <div className="arm-tag" key={a.id}>
                      {a.name}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <span className="arm-remove" title="Move up" onClick={() => moveLevel(level.id, -1)} style={idx === 0 ? { opacity: 0.3, pointerEvents: 'none' } : undefined}>
                    ↑
                  </span>
                  <span
                    className="arm-remove"
                    title="Move down"
                    onClick={() => moveLevel(level.id, 1)}
                    style={idx === sortedLevels.length - 1 ? { opacity: 0.3, pointerEvents: 'none' } : undefined}
                  >
                    ↓
                  </span>
                  <span
                    className="arm-remove"
                    title="Rename"
                    onClick={() => {
                      setRenamingId(level.id);
                      setRenameValue(level.name);
                    }}
                  >
                    ✎
                  </span>
                  <span className="arm-remove" title="Remove level" onClick={() => removeLevel(level.id)}>
                    ✕
                  </span>
                </div>
                <div className="chevron">▸</div>
              </div>

              <div className="level-body">
                {levelArms.map((arm) => (
                  <div className="arm-row" key={arm.id}>
                    <div className="arm-badge">{arm.name}</div>
                    <div className="arm-name">
                      {level.name} {arm.name}
                    </div>
                    <div className="arm-remove" onClick={() => removeArm(arm.id)}>
                      ✕
                    </div>
                  </div>
                ))}
                <div className="add-arm-row">
                  <input
                    type="text"
                    placeholder="New arm name, e.g. D"
                    value={newArmName[level.id] ?? ''}
                    onChange={(e) => {
                      setNewArmName((prev) => ({ ...prev, [level.id]: e.target.value }));
                      setArmError((prev) => ({ ...prev, [level.id]: '' }));
                    }}
                  />
                  <button onClick={() => addArm(level.id)}>Add arm</button>
                </div>
                {armError[level.id] && (
                  <p className="field-error" style={{ display: 'block' }}>
                    {armError[level.id]}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {addingLevel ? (
        <div className="add-arm-row" style={{ marginTop: 0 }}>
          <input
            type="text"
            placeholder="Class level name, e.g. Creche"
            value={newLevelName}
            onChange={(e) => {
              setNewLevelName(e.target.value);
              setAddLevelError(null);
            }}
            autoFocus
          />
          <button onClick={addLevel}>Add</button>
          <button
            onClick={() => {
              setAddingLevel(false);
              setNewLevelName('');
              setAddLevelError(null);
            }}
            style={{ color: 'var(--slate-soft)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="add-level-card" onClick={() => setAddingLevel(true)}>
          + Add another class level
        </div>
      )}
      {addLevelError && (
        <p className="field-error" style={{ display: 'block' }}>
          {addLevelError}
        </p>
      )}
    </div>
  );
}
