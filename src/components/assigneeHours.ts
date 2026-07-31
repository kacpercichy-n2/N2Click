// Godziny osoby przypisanej do zadania — czysta logika wartości DOMYŚLNEJ i
// wykrycia „osoby bez godzin”. Bez importu store'u i Reacta (unit-testowalne).
//
// Powód istnienia: przypisanie osoby bez godzin nie tworzy żadnego
// `WorkloadEntry`, więc zadanie nie ma ani bloku w kalendarzu, ani wiersza
// w zasobniku — z punktu widzenia planowania znika. Osoba dopisana do zadania
// dostaje więc bazowo MINIMALNY krok planowania (15 minut), a świadome
// wyzerowanie pola zostaje widocznym ostrzeżeniem zamiast cichej pustki.
import { HOURS_STEP, snapHours } from '../utils/time';

/** Domyślne godziny nowo przypisanej osoby: jeden krok siatki = 15 minut. */
export const DEFAULT_ASSIGNEE_HOURS = HOURS_STEP;

/** Ta sama wartość jako tekst pola „godziny” w edytorze. */
export const DEFAULT_ASSIGNEE_HOURS_RAW = String(DEFAULT_ASSIGNEE_HOURS);

/**
 * Mapa surowych godzin (personId -> tekst pola) po PRZYPISANIU osoby: brakująca
 * albo pusta wartość dostaje domyślne 15 minut, każda inna — w tym świadome
 * „0” i wartość istniejącego zadania — zostaje nietknięta. Przy braku zmiany
 * zwracana jest TA SAMA referencja, więc setter Reacta nie budzi renderu.
 */
export function withAssigneeHoursDefault(
  raw: Record<string, string>,
  personId: string,
): Record<string, string> {
  if ((raw[personId] ?? '').trim() !== '') return raw;
  return { ...raw, [personId]: DEFAULT_ASSIGNEE_HOURS_RAW };
}

/**
 * Ta sama zasada dla WIELU osób naraz (wstępny wybór osoby przy nowym zadaniu).
 */
export function withAssigneeHoursDefaults(
  raw: Record<string, string>,
  personIds: readonly string[],
): Record<string, string> {
  return personIds.reduce<Record<string, string>>(
    (acc, personId) => withAssigneeHoursDefault(acc, personId),
    raw,
  );
}

/**
 * Czy przypisana osoba nie ma na zadaniu ANI JEDNEJ godziny — ani sprzedanej,
 * ani rozplanowanej w kalendarzu? Taka para (zadanie, osoba) nie ma wiersza
 * `WorkloadEntry`, więc nie pokaże się ani w kalendarzu, ani w zasobniku.
 * Sprzedane 0 przy godzinach w kalendarzu to INNY przypadek (osobne
 * ostrzeżenie „w kalendarzu więcej niż godziny osoby”), więc nie liczy się tu.
 */
export function assigneeHasNoHours(soldHours: number, datedHours: number): boolean {
  const sold = Number.isFinite(soldHours) ? snapHours(soldHours) : 0;
  const dated = Number.isFinite(datedHours) ? snapHours(datedHours) : 0;
  return sold <= 0 && dated <= 0;
}
