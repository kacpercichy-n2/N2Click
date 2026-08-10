// Nazwa kopii zadania („Duplikuj zadanie”, zgłoszenie 2026-08-06): kopia
// dostaje dopisek „ - kopia”, a kolejne kopie numer („ - kopia 2”, „ - kopia 3”…),
// żeby nazwy nigdy nie były identyczne (czystość danych). Duplikowanie kopii
// NIE piętrzy dopisków — baza nazwy jest liczona po zdjęciu istniejącego
// dopisku, więc kopia kopii to po prostu następny wolny numer tej samej bazy.
// Czysty moduł: zero importu store'u.

const COPY_SUFFIX_RE = /\s*-\s*kopia(?:\s+\d+)?$/i;

/** Zdejmuje dopisek „ - kopia( N)” z końca tytułu; bez dopisku zwraca tytuł. */
export function stripCopySuffix(title: string): string {
  const base = title.replace(COPY_SUFFIX_RE, '').trimEnd();
  // Tytuł będący SAMYM dopiskiem („- kopia”) nie ma sensownej bazy — zostaje.
  return base === '' ? title : base;
}

/**
 * Pierwszy wolny tytuł kopii względem `existingTitles` (porównanie po trim).
 * Kolejność prób: „X - kopia”, „X - kopia 2”, „X - kopia 3”…
 */
export function copyTitle(existingTitles: readonly string[], sourceTitle: string): string {
  const base = stripCopySuffix(sourceTitle.trim());
  const taken = new Set(existingTitles.map((t) => t.trim()));
  const first = `${base} - kopia`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} - kopia ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
