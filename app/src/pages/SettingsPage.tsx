import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../lib/AppContext';
import { useActiveSession } from '../hooks/useActiveSession';
import SessionBootstrap from '../components/SessionBootstrap';
import ClassesArmsTab from '../components/settings/ClassesArmsTab';
import FeeItemsTab from '../components/settings/FeeItemsTab';

export default function SettingsPage() {
  const { account } = useAppContext();
  const { session: activeSession, isLoading } = useActiveSession();
  const [tab, setTab] = useState<'classes' | 'fees'>('classes');

  if (isLoading) return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>;

  if (!activeSession) {
    // Reactive query above will pick up the new session automatically once
    // created, so no manual state transition is needed here.
    return <SessionBootstrap schoolId={account.school_id} onComplete={() => {}} />;
  }

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
        <button onClick={() => setTab('classes')} disabled={tab === 'classes'}>
          Classes &amp; Arms
        </button>
        <button onClick={() => setTab('fees')} disabled={tab === 'fees'}>
          Fee Items
        </button>
      </div>

      {tab === 'classes' && <ClassesArmsTab activeSessionId={activeSession.id} />}
      {tab === 'fees' && <FeeItemsTab />}
    </div>
  );
}
