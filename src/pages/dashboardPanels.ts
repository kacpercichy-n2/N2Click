// Pure display helpers behind the Panel (DashboardPage) tiles. No React, no
// store access — just the two rules the page needs so the JSX stays declarative
// and the logic is unit-testable (mirrors the kanbanBoard.ts pattern).
//
// Rules encoded here:
// - Powiadomienia renders at most `MAX_NOTIFICATIONS` rows. The rows themselves
//   are derived by `notificationsForPerson` (selectors.ts); this module only
//   owns the display cap, so it stays a pure, generic slice.
// - The Zespół header shows a counter only when there is at least one coworker:
//   `Zespół` with 0, `Zespół (N)` otherwise.

/** Minimal shape the cap needs: anything with a stable id. */
export interface NotificationEntry {
  id: string;
  title: string;
  when?: string;
}

/** At most this many notification rows are ever shown in the tile. */
export const MAX_NOTIFICATIONS = 3;

/** The notifications actually rendered: the first `MAX_NOTIFICATIONS` entries.
 *  Generic so it caps whatever row type the page derives (see
 *  `PersonNotification`), not just the bare `NotificationEntry`. */
export function visibleNotifications<T extends { id: string }>(entries: readonly T[]): T[] {
  return entries.slice(0, MAX_NOTIFICATIONS);
}

/** Zespół header label: bare when empty, counted otherwise. */
export function teamHeaderLabel(coworkerCount: number): string {
  return coworkerCount > 0 ? `Zespół (${coworkerCount})` : 'Zespół';
}
