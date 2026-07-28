// JEDNO źródło prawdy dla ścieżki adresowej „Klient › Projekt” (SY-06).
// Bez Reacta i bez store'a — wejściem są nazwy, wyjściem gotowy tekst.
//
// Reguła jest jedna dla całej aplikacji: kolejność Klient → Projekt (od ogółu
// do szczegółu), separator `›`, zwykły tekst (klasa `.entity-path`: bez
// wersalików, bez monospace, bez ramki i tła). Ta funkcja zastąpiła
// `taskCardPath` z `src/pages/taskCardMobile.ts` (separator `/`, tylko karta
// telefonu) — zachowania brzegowe są te same.

/** Separator ścieżki. Jedyne miejsce, w którym wolno go zmienić. */
export const ENTITY_PATH_SEPARATOR = '›';

/** Nazwa jest „obecna” tylko wtedy, gdy niesie treść — puste pole to brak. */
function present(name: string | undefined | null): string {
  return (name ?? '').trim();
}

/**
 * Ścieżka adresowa zadania/karty w jednym wierszu:
 * - klient i projekt → „Klient › Projekt”,
 * - sam projekt (osierocony / nieznany klient) → „Projekt”,
 * - sam klient (w praktyce niemożliwe — klienta czytamy przez projekt — ale
 *   degradujemy miękko) → „Klient”,
 * - nic → „—”.
 *
 * Wywołujący, który ma własną degradację braku projektu (Kanban: „Bez
 * projektu”), podaje ją jako `projectName` — ta funkcja nie zna domen.
 */
export function clientProjectPath(
  clientName: string | undefined | null,
  projectName: string | undefined | null,
): string {
  const client = present(clientName);
  const project = present(projectName);
  if (client !== '' && project !== '') return `${client} ${ENTITY_PATH_SEPARATOR} ${project}`;
  if (project !== '') return project;
  if (client !== '') return client;
  return '—';
}
