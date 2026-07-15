import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PowerSyncContext } from '@powersync/react';
import type { Session } from '@supabase/supabase-js';
import { powersync, connectPowerSync } from './lib/powersync';
import { supabase } from './lib/supabase';
import { getMyAccount } from './lib/account';
import type { Account } from './lib/account';
import { AppContextProvider } from './lib/AppContext';
import AuthScreen from './components/AuthScreen';
import SchoolSetupForm from './components/SchoolSetupForm';
import ClassLevelSetup from './components/ClassLevelSetup';
import OnboardingSuccess from './components/OnboardingSuccess';
import DashboardPage from './pages/DashboardPage';
import ReportsPage from './pages/ReportsPage';
import ClassRegisterPage from './pages/ClassRegisterPage';
import PaymentsPage from './pages/PaymentsPage';
import ReceiptPage from './pages/ReceiptPage';
import PromotionPage from './pages/PromotionPage';
import AuditLogPage from './pages/AuditLogPage';
import ImportPage from './pages/ImportPage';
import SettingsPage from './pages/SettingsPage';
import StudentsPage from './pages/StudentsPage';
import StudentDetailPage from './pages/StudentDetailPage';

type AppState =
  | { step: 'loading' }
  | { step: 'auth' }
  | { step: 'school-setup' }
  | { step: 'class-levels'; schoolId: string; schoolName: string }
  | { step: 'done'; schoolName: string; levelCount: number }
  | { step: 'ready'; session: Session; account: Account };

function Shell() {
  const [state, setState] = useState<AppState>({ step: 'loading' });
  const [syncStatus, setSyncStatus] = useState('connecting…');

  useEffect(() => {
    let unsubscribeSync: (() => void) | undefined;

    async function resolve(session: Session | null) {
      if (!session) {
        setState({ step: 'auth' });
        return;
      }

      if (!unsubscribeSync) {
        connectPowerSync().catch((err) => setSyncStatus(`error: ${err.message}`));
        unsubscribeSync = powersync.registerListener({
          statusChanged: (s) => setSyncStatus(s.connected ? 'synced' : 'offline — changes queued locally')
        });
      }

      const account = await getMyAccount(session.user.id);
      setState(account ? { step: 'ready', session, account } : { step: 'school-setup' });
    }

    supabase.auth.getSession().then(({ data }) => resolve(data.session));
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => resolve(session));

    return () => {
      subscription.unsubscribe();
      unsubscribeSync?.();
    };
  }, []);

  switch (state.step) {
    case 'loading':
      return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>;
    case 'auth':
      return <AuthScreen />;
    case 'school-setup':
      return (
        <SchoolSetupForm
          onComplete={(schoolId, schoolName) => setState({ step: 'class-levels', schoolId, schoolName })}
        />
      );
    case 'class-levels':
      return (
        <ClassLevelSetup
          schoolId={state.schoolId}
          onComplete={(levelCount) => setState({ step: 'done', schoolName: state.schoolName, levelCount })}
        />
      );
    case 'done':
      return (
        <OnboardingSuccess
          schoolName={state.schoolName}
          levelCount={state.levelCount}
          onContinue={() => {
            supabase.auth.getSession().then(async ({ data }) => {
              if (!data.session) return;
              const account = await getMyAccount(data.session.user.id);
              if (account) setState({ step: 'ready', session: data.session, account });
            });
          }}
        />
      );
    case 'ready':
      return (
        <AppContextProvider value={{ session: state.session, account: state.account }}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<DashboardPage syncStatus={syncStatus} />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/class-register" element={<ClassRegisterPage />} />
              <Route path="/payments" element={<PaymentsPage />} />
              <Route path="/household-payment" element={<Navigate to="/payments" replace />} />
              <Route path="/receipt/:txnId" element={<ReceiptPage />} />
              <Route path="/promotion" element={<PromotionPage />} />
              <Route path="/audit-log" element={<AuditLogPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/students/new" element={<Navigate to="/students?add=1" replace />} />
              <Route path="/students/:id" element={<StudentDetailPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AppContextProvider>
      );
  }
}

export default function App() {
  return (
    <PowerSyncContext.Provider value={powersync}>
      <Shell />
    </PowerSyncContext.Provider>
  );
}
