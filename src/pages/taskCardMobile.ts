// Czyste pomocniki telefonowej karty zadania (lista „Zadania”). Bez Reacta,
// bez store'a — wejściem są gotowe listy, więc całość testuje się w
// środowisku `node` (wzorzec `dashboardPanels.ts` / `taskModalSections.ts`).
//
// Reguła zakodowana tutaj: trzyrzędowa karta ma miejsce na KILKA awatarów, nie
// na wszystkie — pokazuje pierwsze `MAX_CARD_AVATARS` osób, a resztę zwija do
// plakietki „+N”.
//
// Ścieżka adresowa karty przeniosła się do `src/utils/entityPath.ts`
// (`clientProjectPath`, separator `›`) — jest teraz WSPÓLNA dla listy zadań,
// arkusza szczegółów i Kanbana, więc nie ma tu jej lokalnej kopii.

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
