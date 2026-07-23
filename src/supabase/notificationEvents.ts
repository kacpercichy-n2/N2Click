// Czyste generowanie zdarzeń powiadomień in-app z DIFFA stanu (prev -> next).
// Testowalne w node — bez SDK, bez store'a, bez React. Wołane z warstwy mirror
// (CloudSyncProvider) PO reduktorze: zdarzenia liczy się z różnicy stanu, więc
// odrzucona komenda (ta sama referencja) nie daje różnicy => zero powiadomień.
//
// MODEL: działający użytkownik generuje powiadomienia DLA INNYCH osób (odbiorców)
// i wstawia je do chmury. Własne powiadomienia odbiorca dostaje przez hydrację
// (SELECT own rows, RLS). Dlatego NIGDY nie tworzymy powiadomienia „dla samego
// siebie" (recipient === actor jest pomijany).
//
// Trzy punkty zaczepienia (najmniej inwazyjne — diff istniejących kolekcji):
//   (a) task_assigned  — nowa para przypisania (task, osoba), zadanie opublikowane;
//   (b) project_comment — nowy komentarz do projektu -> uczestnicy (osoby
//                         przypisane do zadań projektu), poza autorem;
//   (c) bin_item        — nowy wiersz ZASOBNIKA (praca bez terminu) dla osoby.
// (a) i (c) dla tej samej pary (odbiorca, zadanie) w jednym diffie: (a) wygrywa
// (nie dublujemy „przypisano" + „nowa praca w zasobniku").
import type { AppData, NotificationPayload, NotificationType } from '../types';
import { BIN_DATE } from '../utils/time';
import type { CloudIdMaps } from './cloudMirror';

/** Jeden wiersz do wstawienia w `public.notifications` (bez id — Postgres nada
 *  `gen_random_uuid()`; bez created_at — default now()). */
export interface NotificationInsertRow {
  recipient_id: string;
  type: NotificationType;
  payload: NotificationPayload;
}

/**
 * Liczy powiadomienia do wstawienia z różnicy stanu. `actorProfileId` to id konta
 * działającego użytkownika (auth.users id == id profilu == lokalne id osoby po
 * autorytatywnej hydracji). Odbiorca rozwiązywany jak w cloudMirror: mapa
 * local->cloud, a bez pary — id chmury, o ile widoczny w snapshocie; inaczej
 * wiersz jest pomijany (brak konta => nie da się dostarczyć).
 */
export function notificationInsertsFromDiff(
  prev: AppData,
  next: AppData,
  maps: CloudIdMaps,
  actorProfileId: string,
): NotificationInsertRow[] {
  const profileOf = (personId: string): string | undefined =>
    maps.people.get(personId) ??
    (maps.cloudProfileIds.has(personId) ? personId : undefined);

  const rows: NotificationInsertRow[] = [];
  const nextTaskById = new Map(next.tasks.map((t) => [t.id, t]));

  // (a) task_assigned — nowe pary przypisań do OPUBLIKOWANYCH zadań.
  const prevPairs = new Set(prev.assignments.map((a) => `${a.taskId}|${a.personId}`));
  // Klucze (odbiorca-profil | zadanie) już powiadomione przez (a) — dedupe dla (c).
  const assignedRecipientTask = new Set<string>();
  for (const a of next.assignments) {
    const key = `${a.taskId}|${a.personId}`;
    if (prevPairs.has(key)) continue;
    const recipient = profileOf(a.personId);
    if (recipient === undefined || recipient === actorProfileId) continue;
    const task = nextTaskById.get(a.taskId);
    if (!task || task.isDraft === true) continue; // szkic to jeszcze nie praca
    assignedRecipientTask.add(`${recipient}|${a.taskId}`);
    rows.push({
      recipient_id: recipient,
      type: 'task_assigned',
      payload: { taskId: a.taskId, projectId: task.projectId, actorId: actorProfileId },
    });
  }

  // (b) project_comment — nowe komentarze do projektu -> uczestnicy projektu.
  // Uczestnicy = osoby przypisane do zadań tego projektu (lokalnie nie ma osobnej
  // listy członków). Autorem jest zawsze działający użytkownik (recipient===actor
  // pomijany), więc sam siebie nie powiadomi.
  const prevCommentIds = new Set(prev.comments.map((c) => c.id));
  for (const c of next.comments) {
    if (prevCommentIds.has(c.id) || c.entityType !== 'project') continue;
    const projectId = c.entityId;
    const taskIds = new Set(
      next.tasks.filter((t) => t.projectId === projectId).map((t) => t.id),
    );
    const seen = new Set<string>();
    for (const a of next.assignments) {
      if (!taskIds.has(a.taskId) || seen.has(a.personId)) continue;
      seen.add(a.personId);
      const recipient = profileOf(a.personId);
      if (recipient === undefined || recipient === actorProfileId) continue;
      rows.push({
        recipient_id: recipient,
        type: 'project_comment',
        payload: { projectId, commentId: c.id, actorId: actorProfileId },
      });
    }
  }

  // (c) bin_item — nowe pary zasobnika (praca bez terminu) dla osoby.
  const prevBinPairs = new Set(
    prev.workload.filter((w) => w.date === BIN_DATE).map((w) => `${w.taskId}|${w.personId}`),
  );
  const emittedBinPairs = new Set<string>();
  for (const w of next.workload) {
    if (w.date !== BIN_DATE) continue;
    const pairKey = `${w.taskId}|${w.personId}`;
    if (prevBinPairs.has(pairKey) || emittedBinPairs.has(pairKey)) continue;
    emittedBinPairs.add(pairKey);
    const recipient = profileOf(w.personId);
    if (recipient === undefined || recipient === actorProfileId) continue;
    // Dedupe z (a): „przypisano zadanie" już pokrywa nową pracę tej pary.
    if (assignedRecipientTask.has(`${recipient}|${w.taskId}`)) continue;
    const task = nextTaskById.get(w.taskId);
    if (!task) continue;
    rows.push({
      recipient_id: recipient,
      type: 'bin_item',
      payload: { taskId: w.taskId, projectId: task.projectId, actorId: actorProfileId },
    });
  }

  return rows;
}
