import { supabase } from './supabase';

export interface Account {
  id: string;
  school_id: string;
  email: string;
  role: string;
  created_at: string;
}

// Returns null if this logged-in user hasn't completed school setup yet —
// that's how the app tells "needs onboarding" apart from "ready to use."
export async function getMyAccount(userId: string): Promise<Account | null> {
  const { data, error } = await supabase.from('accounts').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
