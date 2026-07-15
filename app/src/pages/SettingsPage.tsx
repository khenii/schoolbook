import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SessionsTab from '../components/settings/SessionsTab';
import ClassesArmsTab from '../components/settings/ClassesArmsTab';
import FeeItemsTab from '../components/settings/FeeItemsTab';

type TabId = 'sessions' | 'classes' | 'fees';
const VALID_TABS: TabId[] = ['sessions', 'classes', 'fees'];

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const initialTab: TabId = VALID_TABS.includes(requested as TabId) ? (requested as TabId) : 'sessions';
  const [tab, setTab] = useState<TabId>(initialTab);

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
      <h1>School setup</h1>
      <p style={{ color: 'var(--color-slate)' }}>
        Everything that shapes how the rest of Schoolbook works for your school.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '1.5rem 0' }}>
        <button onClick={() => setTab('sessions')} disabled={tab === 'sessions'}>
          Sessions
        </button>
        <button onClick={() => setTab('classes')} disabled={tab === 'classes'}>
          Classes &amp; Arms
        </button>
        <button onClick={() => setTab('fees')} disabled={tab === 'fees'}>
          Fee Items
        </button>
      </div>

      {tab === 'sessions' && <SessionsTab />}
      {tab === 'classes' && <ClassesArmsTab />}
      {tab === 'fees' && <FeeItemsTab />}
    </div>
  );
}
