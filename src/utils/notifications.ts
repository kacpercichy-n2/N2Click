// Czyste helpery powiadomień in-app: strażniki typu i sanityzacja ładunku.
// Bez importów store/komponentów — używane na trzech granicach (repair wczytania
// w storage.ts, hydracja chmury w plannerData.ts, walidacja reduktora
// MERGE_CLOUD_NOTIFICATIONS). Etykiety/treść po polsku żyją w dashboardPanels.ts,
// poza zdaniem rozmowy zadania (taskConversationNotificationTitle niżej), które
// dzielą feed (selectors.ts) i kafel Panelu (dashboardPanels.ts).
import type { NotificationPayload, NotificationType } from '../types';

export const NOTIFICATION_TYPES: NotificationType[] = [
  'task_assigned',
  'task_message',
  'task_mention',
  'project_comment',
  'bin_item',
];

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as string[]).includes(v);
}

/** Klucze ładunku, które przenosimy (reszta jest ignorowana). Wszystkie to
 *  stringi (id encji / osoby); pusty/nie-string => klucz pominięty. Wyjątek:
 *  `count` (liczba wiadomości zbiorczego task_message, 20261102103000) to
 *  dodatnia liczba całkowita. */
type SanitizedNotificationPayload = NotificationPayload & {
  conversationId?: string;
  messageId?: string;
  count?: number;
};

const PAYLOAD_KEYS: Array<Exclude<keyof SanitizedNotificationPayload, 'count'>> = [
  'taskId',
  'conversationId',
  'messageId',
  'projectId',
  'commentId',
  'actorId',
];

/**
 * Sanityzuje surowy ładunek (jsonb / localStorage) do kanonicznego
 * `NotificationPayload`: tylko znane klucze, każda wartość to niepusty string.
 * Wejście spoza obiektu => pusty ładunek `{}`. Idempotentne.
 */
export function sanitizeNotificationPayload(raw: unknown): SanitizedNotificationPayload {
  if (typeof raw !== 'object' || raw === null) return {};
  const rec = raw as Record<string, unknown>;
  const out: SanitizedNotificationPayload = {};
  for (const key of PAYLOAD_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  const count = rec.count;
  if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 1) out.count = count;
  return out;
}

/**
 * Ile nowych wiadomości niesie wiersz rozmowy zadania. Baza trzyma jeden
 * nieprzeczytany task_message na rozmowę i podbija w nim `count`; brak albo
 * zła wartość (starszy wiersz, task_mention) = 1.
 */
export function notificationMessageCount(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) return 1;
  const count = (payload as { count?: unknown }).count;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 1 ? count : 1;
}

/** „nowe wiadomości” / „nowych wiadomości” po liczebniku (2-4 bez 12-14 = nowe). */
function newMessagesPhrase(count: number): string {
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  const few = lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return few ? 'nowe wiadomości' : 'nowych wiadomości';
}

/**
 * Zdanie powiadomienia z rozmowy zadania (feed, dzwonek, kafel Panelu):
 *   * task_mention: „Ola Nowak wspomniał(a) Cię w zadaniu: Key visual”,
 *   * task_message, 1 wiadomość: „Nowa wiadomość od Ola Nowak w zadaniu: Key visual”,
 *   * task_message, kilka: „3 nowe wiadomości w zadaniu: Key visual”
 *     (5 i więcej: „nowych wiadomości”).
 * Pusty aktor = nieznany: „Ktoś” we wzmiance, bez „od …” przy wiadomości.
 */
export function taskConversationNotificationTitle(
  type: 'task_message' | 'task_mention',
  actorName: string,
  taskTitle: string,
  count: number,
): string {
  const actor = actorName.trim();
  if (type === 'task_mention') return `${actor || 'Ktoś'} wspomniał(a) Cię w zadaniu: ${taskTitle}`;
  if (count > 1) return `${count} ${newMessagesPhrase(count)} w zadaniu: ${taskTitle}`;
  return actor ? `Nowa wiadomość od ${actor} w zadaniu: ${taskTitle}` : `Nowa wiadomość w zadaniu: ${taskTitle}`;
}
