// Pure display helpers behind the Panel (DashboardPage) tiles. No React, no
// store access — just the rules the page needs so the JSX stays declarative and
// the logic is unit-testable (mirrors the kanbanBoard.ts pattern).
//
// Rules encoded here:
// - Powiadomienia renders at most `MAX_NOTIFICATIONS` rows. The rows themselves
//   are derived by `notificationsForPerson` (selectors.ts); this module only
//   owns the display cap plus pure row builders, so it stays a generic slice.
// - The Zespół header shows a counter only when there is at least one coworker:
//   `Zespół` with 0, `Zespół (N)` otherwise.
import type { Notification } from '../types';

/** Dokąd prowadzi klik w powiadomienie: zadanie (modal) albo projekt (route). */
export type NotificationTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'project'; projectId: string };

/** A single notification row prepared for display (Polish title + click target). */
export interface NotificationEntry {
  id: string;
  title: string;
  when?: string;
  target?: NotificationTarget;
}

/** Nazwy encji rozwiązane przez wołającego (selektory), wstrzyknięte do czystego
 *  buildera treści — pusty string = encja nieznana (fallback niżej). */
export interface NotificationNames {
  actorName: string;
  taskTitle: string;
  projectName: string;
}

/**
 * Buduje polską treść powiadomienia (kto, co, gdzie) + cel kliknięcia z rekordu
 * `Notification` i rozwiązanych nazw. Czyste — testowalne bez store'a. Braki nazw
 * degradują się miękko (aktor => „Ktoś”, encja => „—”).
 */
export function notificationEntry(n: Notification, names: NotificationNames): NotificationEntry {
  const actor = names.actorName.trim() || 'Ktoś';
  const taskTitle = names.taskTitle.trim() || '—';
  const projectName = names.projectName.trim() || '—';
  const projectMeta = names.projectName.trim() || undefined;
  switch (n.type) {
    case 'task_assigned':
      return {
        id: n.id,
        title: `${actor} przypisał(a) Ci zadanie „${taskTitle}”`,
        when: projectMeta,
        target: n.payload.taskId ? { kind: 'task', taskId: n.payload.taskId } : undefined,
      };
    case 'project_comment':
      return {
        id: n.id,
        title: `${actor} skomentował(a) projekt „${projectName}”`,
        target: n.payload.projectId ? { kind: 'project', projectId: n.payload.projectId } : undefined,
      };
    case 'bin_item':
      return {
        id: n.id,
        title: `Nowa praca w zasobniku: „${taskTitle}”`,
        when: projectMeta,
        target: n.payload.taskId ? { kind: 'task', taskId: n.payload.taskId } : undefined,
      };
  }
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
