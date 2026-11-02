// Czysty model nagłówka panelu „Rozmowa” w karcie zadania (karta v2).
import { personLabel, type ChatDirectory } from './chatPeople';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zadanie ma już wiersz w chmurze (id to uuid). Szkic albo zadanie jeszcze
 * niezsynchronizowane nie ma rozmowy: `chat_open_task(uuid)` by się wywrócił.
 */
export function isCloudTaskId(taskId: string): boolean {
  return UUID_PATTERN.test(taskId);
}

/** Pierwsze `max` awatarów i reszta jako „+n”. */
export function visibleFollowers(
  ids: readonly string[],
  max: number,
): { ids: string[]; rest: number } {
  const limit = Math.max(0, Math.floor(max));
  if (ids.length <= limit) return { ids: ids.slice(), rest: 0 };
  return { ids: ids.slice(0, limit), rest: ids.length - limit };
}

/** Nazwa dostępna grupki awatarów: „Obserwują: Ola Nowak, Kasia Kowalska”. */
export function followersSummary(directory: ChatDirectory, ids: readonly string[]): string {
  if (ids.length === 0) return 'Nikt nie obserwuje rozmowy';
  return `Obserwują: ${ids.map((id) => personLabel(directory, id)).join(', ')}`;
}

/** Minimalny kształt wiersza `notifications` potrzebny do gaszenia. */
export interface TaskNotificationRow {
  id: string;
  recipientId: string;
  type: string;
  payload: { taskId?: string };
  readAt: string;
}

/**
 * Wiersze powiadomień rozmowy TEGO zadania (task_message / task_mention)
 * zalogowanej osoby, jeszcze bez `read_at`. Panel oznacza je przeczytanymi,
 * gdy użytkownik ogląda najnowszą wiadomość. Wpis przeczytany watermarkiem
 * reduktor i tak pominie (ta sama referencja stanu).
 */
export function unreadTaskConversationNotifications(
  notifications: readonly TaskNotificationRow[],
  taskId: string,
  recipientId: string,
): string[] {
  if (taskId === '' || recipientId === '') return [];
  return notifications
    .filter(
      (n) =>
        (n.type === 'task_message' || n.type === 'task_mention') &&
        n.recipientId === recipientId &&
        n.payload.taskId === taskId &&
        n.readAt === '',
    )
    .map((n) => n.id);
}
