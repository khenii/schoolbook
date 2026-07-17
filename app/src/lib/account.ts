import { supabase } from './supabase';
import { powersync } from './powersync';

export interface Account {
  id: string;
  school_id: string;
  email: string;
  role: string;
  created_at: string;
}

// Returns null if this logged-in user hasn't completed school setup yet —
// that's how the app tells "needs onboarding" apart from "ready to use."
//
// `accounts` is part of the PowerSync-synced schema, so a returning user who
// has already been online once has this row sitting in local SQLite. Read
// that first: it resolves instantly and works fully offline, which matters
// because this function gates the entire app shell (see App.tsx's resolve())
// — every background token refresh re-runs it, and this app is supposed to
// keep working without a network connection. Only fall back to a live
// Supabase fetch when nothing has synced locally yet (first-ever login on a
// fresh device, before any sync has completed) — that case genuinely
// requires network, same as signing in does.
export async function getMyAccount(userId: string): Promise<Account | null> {
  const local = await powersync.getOptional<Account>('SELECT * FROM accounts WHERE id = ?', [userId]);
  if (local) return local;

  if (!navigator.onLine) {
    // No local copy yet and no network to fetch one — don't guess at
    // "needs onboarding" here. Let the caller leave the UI as-is and retry
    // once connectivity (or the next sync) makes a real answer available.
    throw new Error('Account lookup unavailable offline: nothing synced locally yet');
  }

  const { data, error } = await supabase.from('accounts').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
