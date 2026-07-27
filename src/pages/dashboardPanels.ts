// Pure display helpers behind the Panel (DashboardPage) tiles. No React, no
// store access — just the rules the page needs so the JSX stays declarative and
// the logic is unit-testable (mirrors the kanbanBoard.ts pattern).
//
// Rules encoded here:
// - Powiadomienia renders at most `MAX_NOTIFICATIONS` UNREAD entries; the page
//   feeds it `unreadNotificationsForPerson` mapped through `notificationEntry`.
// - The Zespół header shows a counter only when there is at least one coworker:
//   `Zespół` with 0, `Zespół (N)` otherwise.
import type { Notification } from '../types';

/** Dokąd prowadzi klik w powiadomienie: zadanie (modal) albo projekt (route). */
export type NotificationTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'project'; projectId: string };

/** Rozwinięty podgląd wiersza powiadomienia (kto / co / gdzie [+ treść]). */
export interface NotificationPreview {
  who: string; // aktor albo „Ktoś”
  what: string; // czego dotyczy (tytuł zadania / nazwa projektu)
  where: string; // projekt albo „—”
  /** Treść komentarza — tylko dla `project_comment`, gdy jest dostępna. */
  body?: string;
}

/** A single notification row prepared for display (Polish title + click target).
 *  Klik w wiersz ROZWIJA `preview` (nic nie dispatchuje — kafelek pokazuje tylko
 *  nieprzeczytane, więc auto-oznaczanie usunęłoby wiersz w trakcie czytania);
 *  otwarcie encji jest osobną akcją opisaną przez `openLabel`. */
export interface NotificationEntry {
  id: string;
  title: string;
  when?: string;
  target?: NotificationTarget;
  preview: NotificationPreview;
  /** Etykieta akcji wtórnej; `undefined` = brak celu, przycisk ukryty. */
  openLabel?: string;
}

/** Nazwy encji rozwiązane przez wołającego (selektory), wstrzyknięte do czystego
 *  buildera treści — pusty string = encja nieznana (fallback niżej). */
export interface NotificationNames {
  actorName: string;
  taskTitle: string;
  projectName: string;
  /** Treść komentarza rozwiązana przez wołającego; '' = brak/nieznana. */
  commentBody: string;
}

/** Etykieta akcji „otwórz” dla celu kliknięcia (brak celu => brak przycisku). */
function openLabelFor(target: NotificationTarget | undefined): string | undefined {
  if (!target) return undefined;
  return target.kind === 'task' ? 'Otwórz zadanie' : 'Otwórz projekt';
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
  const commentBody = names.commentBody.trim();
  switch (n.type) {
    case 'task_assigned': {
      const target: NotificationTarget | undefined = n.payload.taskId
        ? { kind: 'task', taskId: n.payload.taskId }
        : undefined;
      return {
        id: n.id,
        title: `${actor} przypisał(a) Ci zadanie „${taskTitle}”`,
        when: projectMeta,
        target,
        preview: { who: actor, what: taskTitle, where: projectName },
        openLabel: openLabelFor(target),
      };
    }
    case 'project_comment': {
      const target: NotificationTarget | undefined = n.payload.projectId
        ? { kind: 'project', projectId: n.payload.projectId }
        : undefined;
      return {
        id: n.id,
        title: `${actor} skomentował(a) projekt „${projectName}”`,
        target,
        // Klucz `body` istnieje TYLKO gdy treść komentarza jest znana — nigdy
        // pusty string ani jawne `undefined`.
        preview: {
          who: actor,
          what: projectName,
          where: projectName,
          ...(commentBody ? { body: commentBody } : {}),
        },
        openLabel: openLabelFor(target),
      };
    }
    case 'bin_item': {
      const target: NotificationTarget | undefined = n.payload.taskId
        ? { kind: 'task', taskId: n.payload.taskId }
        : undefined;
      return {
        id: n.id,
        title: `Nowa praca w zasobniku: „${taskTitle}”`,
        when: projectMeta,
        target,
        preview: { who: actor, what: taskTitle, where: projectName },
        openLabel: openLabelFor(target),
      };
    }
  }
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
