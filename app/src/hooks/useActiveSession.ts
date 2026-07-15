import { useQuery } from '@powersync/react';

export interface SessionRow {
  id: string;
  school_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_active: number;
  created_at: string;
}

// Reactive: automatically re-fires once a new session syncs into local
// SQLite, so callers don't need to manually refetch after creating one.
export function useActiveSession() {
  const { data, isLoading, error } = useQuery<SessionRow>(
    'SELECT * FROM sessions WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1'
  );
  return { session: data?.[0] ?? null, isLoading, error };
}
