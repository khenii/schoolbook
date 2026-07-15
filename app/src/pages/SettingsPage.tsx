import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import SessionsTab from '../components/settings/SessionsTab';
import ClassesArmsTab from '../components/settings/ClassesArmsTab';
import FeeItemsTab from '../components/settings/FeeItemsTab';

type TabId = 'sessions' | 'classes' | 'fees';
const VALID_TABS: TabId[] = ['sessions', 'classes', 'fees'];

// Matches 09-settings.html's Classes & Arms / Fee Items tabs, plus a third
// "Sessions" tab the mockup doesn't have at all — sessions/terms and the
// "generate recurring charges" action are real, load-bearing parts of the
// app (spec §3.9/§3.10) with nowhere else to live, so they're styled to
// match the same tab/card family rather than left unstyled. The mockup's
// per-tab "Save changes" button is also dropped: every control here writes
// straight to the database on change (no local draft state to batch-save),
// so a Save button would be decorative.
export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const initialTab: TabId = VALID_TABS.includes(requested as TabId) ? (requested as TabId) : 'sessions';
  const [tab, setTab] = useState<TabId>(initialTab);

  return (
    <AppShell title="Settings" pageClass="page-settings">
      <div className="page-head">
        <div className="eyebrow">Configuration</div>
        <h2>School setup</h2>
        <p>
          Everything that shapes how the rest of Schoolbook works for your school — sessions and terms, class
          structure, and what students get charged for.
        </p>
      </div>

      <div className="tabs">
        <div className={`tab${tab === 'sessions' ? ' active' : ''}`} onClick={() => setTab('sessions')}>
          Sessions
        </div>
        <div className={`tab${tab === 'classes' ? ' active' : ''}`} onClick={() => setTab('classes')}>
          Classes &amp; Arms
        </div>
        <div className={`tab${tab === 'fees' ? ' active' : ''}`} onClick={() => setTab('fees')}>
          Fee Items
        </div>
      </div>

      {tab === 'sessions' && (
        <div className="view active">
          <SessionsTab />
        </div>
      )}
      {tab === 'classes' && (
        <div className="view active">
          <ClassesArmsTab />
        </div>
      )}
      {tab === 'fees' && (
        <div className="view active">
          <FeeItemsTab />
        </div>
      )}
    </AppShell>
  );
}
