// JEDEN wzór licznika postępu „ile z ilu” (SY-20). Wcześniej ta sama informacja
// pojawiała się z różnymi czasownikami („ukończono 2/5”, „wykonano 3/7”), więc
// modal, karta i podgląd czytały się jak trzy różne rzeczy. Czasownika NIE MA:
// zostaje sam ułamek i nazwa bytu, identyczna na każdej powierzchni.
//
// Czysty moduł: wejściem dwie liczby, wyjściem string. Bez Reacta i store'a.

/** Liczba całkowita, nieujemna; NaN/Infinity/ujemne degradują do 0. */
function safeCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value > 0 ? Math.floor(value) : 0;
}

/**
 * Wspólny rdzeń: „<zrobione>/<wszystkie> <byt>”. `done` nigdy nie przekracza
 * `total` — licznik nie może twierdzić, że zrobiono więcej, niż jest.
 */
function progressLabel(
  done: number | null | undefined,
  total: number | null | undefined,
  unit: string,
): string {
  const all = safeCount(total);
  return `${Math.min(all, safeCount(done))}/${all} ${unit}`;
}

/** Postęp listy kontrolnej, np. „2/5 pozycji”. */
export function itemsProgressLabel(
  done: number | null | undefined,
  total: number | null | undefined,
): string {
  return progressLabel(done, total, 'pozycji');
}

/** Postęp wykonanych bloków pracy, np. „3/7 bloków”. */
export function blocksProgressLabel(
  done: number | null | undefined,
  total: number | null | undefined,
): string {
  return progressLabel(done, total, 'bloków');
}
