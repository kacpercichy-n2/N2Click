// Polska liczba mnoga w jednym miejscu. Reguła była skopiowana trzy razy
// (ClientsPage, ProjectsPage, GlobalSearch) i doszedłby czwarty egzemplarz w
// budowniczym treści potwierdzeń, więc mieszka teraz tutaj. Zero DOM-u i zero
// importów — testuje się w środowisku `node`.

/**
 * Polska reguła mnogości dla liczebników CAŁKOWITYCH:
 * 1 → `one`, 2–4 (poza 12–14) → `few`, reszta → `many`.
 *
 * Uwaga: dla wartości ułamkowych (np. 2,5 godziny) polszczyzna wymaga dopełniacza
 * liczby pojedynczej, więc ułamki NIE przechodzą tędy — patrz `polishAmount`.
 */
export function polishCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

/** Liczba po polsku: przecinek dziesiętny, bez zbędnych zer („2,5”, „12”). */
export function formatPolishNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Godziny chodzą po siatce 0,25 h, więc dwa miejsca wystarczają z zapasem.
  return String(Number(n.toFixed(2))).replace('.', ',');
}

/**
 * „liczba + rzeczownik” dla wartości mogących być UŁAMKIEM (godziny). Ułamek
 * bierze dopełniacz liczby pojedynczej (`fraction`): „2,5 zaplanowanej godziny”,
 * a wartość całkowita zwykłą regułę mnogości: „1 zaplanowana godzina”,
 * „3 zaplanowane godziny”, „12 zaplanowanych godzin”.
 */
export function polishAmount(
  n: number,
  forms: { one: string; few: string; many: string; fraction: string },
): string {
  const noun = Number.isInteger(n)
    ? polishCount(n, forms.one, forms.few, forms.many)
    : forms.fraction;
  return `${formatPolishNumber(n)} ${noun}`;
}

/**
 * JEDEN wzór licznika listy (SY-19): „<widoczne> z <wszystkich> <bytów>”, np.
 * „3 z 21 zadań”. Stoi na końcu paska filtrów każdej listy, która pokazuje
 * licznik.
 *
 * Rzeczownik podaje się w DOPEŁNIACZU LICZBY MNOGIEJ i jest STAŁY — bierze go
 * przyimek „z”, nie liczebnik, więc poprawne jest „z 2 projektów”, a nie
 * „z 2 projekty”. Dlatego `polishCount` tu NIE wchodzi.
 */
export function listCounterLabel(
  visible: number,
  total: number,
  genitivePlural: string,
): string {
  return `${visible} z ${total} ${genitivePlural}`;
}
