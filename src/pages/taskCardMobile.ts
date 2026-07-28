// Czyste pomocniki telefonowej karty zadania (lista „Zadania”). Bez Reacta,
// bez store'a — wejściem są gotowe listy i nazwy, więc całość testuje się w
// środowisku `node` (wzorzec `dashboardPanels.ts` / `taskModalSections.ts`).
//
// Reguły zakodowane tutaj:
// - trzyrzędowa karta ma miejsce na KILKA awatarów, nie na wszystkie: pokazuje
//   pierwsze `MAX_CARD_AVATARS` osób, a resztę zwija do plakietki „+N”,
// - ścieżka projektu na karcie to ZWYKŁY tekst „Klient / Projekt”, nigdy
//   monospace'owa plakietka `.project-badge` (to ona rozpychała kartę).

/** Ile awatarów mieści się w rzędzie metadanych, zanim wchodzi „+N”. */
export const MAX_CARD_AVATARS = 3;

/** Awatary widoczne na karcie + liczba zwiniętych do plakietki „+N”. */
export interface VisibleAssignees<T> {
  shown: T[];
  extra: number;
}

/**
 * Pierwsze `max` osób do pokazania i reszta jako liczba. `max <= 0` chowa
 * wszystkie (cała lista idzie do „+N”), lista krótsza od limitu nie ma reszty.
 */
export function visibleAssignees<T>(
  people: readonly T[],
  max: number = MAX_CARD_AVATARS,
): VisibleAssignees<T> {
  const limit = Math.max(0, max);
  return {
    shown: people.slice(0, limit),
    extra: Math.max(0, people.length - limit),
  };
}

/** Nazwa jest „obecna” tylko wtedy, gdy niesie treść — puste pole to brak. */
function present(name: string | undefined): string {
  return (name ?? '').trim();
}

/**
 * Ścieżka projektu w jednym wierszu karty:
 * - klient i projekt → „Klient / Projekt”,
 * - sam projekt (osierocony / nieznany klient) → „Projekt”,
 * - sam klient (w praktyce niemożliwe — klienta czytamy przez projekt — ale
 *   degradujemy miękko) → „Klient”,
 * - nic → „—”.
 */
export function taskCardPath(
  clientName: string | undefined,
  projectName: string | undefined,
): string {
  const client = present(clientName);
  const project = present(projectName);
  if (client !== '' && project !== '') return `${client} / ${project}`;
  if (project !== '') return project;
  if (client !== '') return client;
  return '—';
}
