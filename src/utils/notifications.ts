// Czyste helpery powiadomień in-app: strażniki typu i sanityzacja ładunku.
// Bez importów store/komponentów — używane na trzech granicach (repair wczytania
// w storage.ts, hydracja chmury w plannerData.ts, walidacja reduktora
// MERGE_CLOUD_NOTIFICATIONS). Etykiety/treść po polsku żyją w dashboardPanels.ts.
import type { NotificationPayload, NotificationType } from '../types';

export const NOTIFICATION_TYPES: NotificationType[] = [
  'task_assigned',
  'project_comment',
  'bin_item',
];

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as string[]).includes(v);
}

/** Klucze ładunku, które przenosimy (reszta jest ignorowana). Wszystkie to
 *  stringi (id encji / osoby); pusty/nie-string => klucz pominięty. */
const PAYLOAD_KEYS: Array<keyof NotificationPayload> = [
  'taskId',
  'projectId',
  'commentId',
  'actorId',
];

/**
 * Sanityzuje surowy ładunek (jsonb / localStorage) do kanonicznego
 * `NotificationPayload`: tylko znane klucze, każda wartość to niepusty string.
 * Wejście spoza obiektu => pusty ładunek `{}`. Idempotentne.
 */
export function sanitizeNotificationPayload(raw: unknown): NotificationPayload {
  if (typeof raw !== 'object' || raw === null) return {};
  const rec = raw as Record<string, unknown>;
  const out: NotificationPayload = {};
  for (const key of PAYLOAD_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}
