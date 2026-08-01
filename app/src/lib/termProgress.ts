// How far a term has gotten, purely from its own start/end dates — nothing
// to do with money. Split out from useDashboardStats so it's independently
// testable and reusable (Reports may eventually want the same "week N of M"
// framing next to its Collections summary).
//
// Returns null when the term has no dates set — createSession() never
// populated start_date/end_date historically (they existed in the schema
// from day one, just unused), and there's no way to *guess* a school's real
// term calendar after the fact. Settings → Sessions now has a "Set dates"
// action per term for exactly this backfill case.
export interface TermProgress {
  totalDays: number;
  elapsedDays: number;
  pctElapsed: number;
  hasNotStarted: boolean;
  hasEnded: boolean;
}

export function computeTermProgress(
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date()
): TermProgress | null {
  if (!startDate || !endDate) return null;

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;

  const dayMs = 86_400_000;
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs));
  const rawElapsed = Math.round((now.getTime() - start.getTime()) / dayMs);
  const elapsedDays = Math.max(0, Math.min(totalDays, rawElapsed));

  return {
    totalDays,
    elapsedDays,
    pctElapsed: Math.round((elapsedDays / totalDays) * 100),
    hasNotStarted: rawElapsed < 0,
    hasEnded: rawElapsed > totalDays
  };
}

export type CollectionPaceStatus = 'on-track' | 'behind' | 'at-risk' | 'no-data';

// A deliberately simple heuristic: collection% "should" roughly track
// time-elapsed% (a school collecting fees at a steady pace through the
// term). How far behind that curve is worth flagging is a real judgment
// call that will vary by school — some push hard for payment up front,
// others don't. These bands (10 / 25 percentage points behind schedule)
// are a reasonable starting default, not a tuned constant. If schools tell
// us this over- or under-alerts in practice, this is the one function to
// revisit — nothing else depends on the exact thresholds.
export function collectionPaceStatus(pctElapsed: number, collectedPct: number | null): CollectionPaceStatus {
  if (collectedPct === null) return 'no-data';
  const gap = pctElapsed - collectedPct;
  if (gap <= 10) return 'on-track';
  if (gap <= 25) return 'behind';
  return 'at-risk';
}
