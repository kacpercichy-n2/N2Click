// Czysta logika dropdownu „Klient" w TaskModalu. Zadanie NIE ma własnego
// clientId — klient wynika z projektu (task → project → client), więc dropdown
// jest pomocnikiem: zawęża listę projektów do wybranego klienta i pozwala
// „przepisać" zadanie do projektu innego klienta w dwóch krokach. Sam wybór
// klienta niczego nie zapisuje.

import { comparePl, sortByNamePl } from '../utils/collation';

export interface ClientPickerOption {
  /** '' = grupa „Bez klienta" (projekty bez klienta lub z usuniętym klientem). */
  id: string;
  name: string;
}

/** Etykieta pozycji zbierającej projekty bez (istniejącego) klienta. */
export const NO_CLIENT_LABEL = 'Bez klienta';

/** Efektywny klient projektu: nieznany/usunięty clientId liczy się jak brak (''). */
export function effectiveProjectClientId(
  project: { clientId: string },
  knownClientIds: ReadonlySet<string>,
): string {
  return knownClientIds.has(project.clientId) ? project.clientId : '';
}

/**
 * Opcje dropdownu klienta: wszyscy klienci alfabetycznie (kolacja pl);
 * „Bez klienta" ('') dokleja się NA KOŃCU tylko wtedy, gdy jakiś projekt
 * faktycznie nie ma istniejącego klienta.
 */
export function clientPickerOptions(
  clients: readonly { id: string; name: string }[],
  projects: readonly { clientId: string }[],
): ClientPickerOption[] {
  const known = new Set(clients.map((c) => c.id));
  const out: ClientPickerOption[] = sortByNamePl(clients).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  if (projects.some((p) => !known.has(p.clientId))) {
    out.push({ id: '', name: NO_CLIENT_LABEL });
  }
  return out;
}

/** Projekty wybranego klienta, alfabetycznie (kolacja pl). Kopia — bez mutacji. */
export function projectsForClient<P extends { name: string; clientId: string }>(
  projects: readonly P[],
  clients: readonly { id: string }[],
  clientId: string,
): P[] {
  const known = new Set(clients.map((c) => c.id));
  return projects
    .filter((p) => effectiveProjectClientId(p, known) === clientId)
    .sort((a, b) => comparePl(a.name, b.name));
}
