// Pure display helpers behind the Panel (DashboardPage) tiles. No React, no
// store access — just the two rules the page needs so the JSX stays declarative
// and the logic is unit-testable (mirrors the kanbanBoard.ts pattern).
//
// Rules encoded here:
// - Powiadomienia is a UI SLOT ONLY: it renders at most `MAX_NOTIFICATIONS`
//   entries. There is no data source yet, so callers pass an empty array; the
//   empty state stays the page's concern.
// - The Zespół header shows a counter only when there is at least one coworker:
//   `Zespół` with 0, `Zespół (N)` otherwise.

/** A single notification row. Local UI type — there is no store/table behind it
 *  yet; a future event source would supply these. */
export interface NotificationEntry {
  id: string;
  title: string;
  when?: string;
}

/** At most this many notification rows are ever shown in the tile. */
export const MAX_NOTIFICATIONS = 3;

/** The notifications actually rendered: the first `MAX_NOTIFICATIONS` entries. */
export function visibleNotifications(
  entries: readonly NotificationEntry[],
): NotificationEntry[] {
  return entries.slice(0, MAX_NOTIFICATIONS);
}

/** Zespół header label: bare when empty, counted otherwise. */
export function teamHeaderLabel(coworkerCount: number): string {
  return coworkerCount > 0 ? `Zespół (${coworkerCount})` : 'Zespół';
}
