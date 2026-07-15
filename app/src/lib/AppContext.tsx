import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Account } from './account';

export interface AppContextValue {
  session: Session;
  account: Account;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({
  value,
  children
}: {
  value: AppContextValue;
  children: React.ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppContextProvider');
  return ctx;
}
