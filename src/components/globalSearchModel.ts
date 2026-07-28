// Czysta logika palety wyszukiwania (GlobalSearch): szybkie akcje, podświetlanie
// dopasowań, komunikat dla czytnika ekranu i lista „ostatnio otwarte”.
// ZERO Reacta i ZERO DOM-u (środowisko `node` w vitest.config.ts) — komponent
// `GlobalSearch.tsx` tylko renderuje to, co policzą te funkcje.
//
// Normalizacja tekstu ma JEDNO źródło: `normalizeSearchText` z selektorów (ten
// sam filtr diakrytyków co `searchAll`), żeby podświetlenie nigdy nie rozjechało
// się z dopasowaniem.
import type { AppData } from '../types';
import { normalizeSearchText } from '../store/selectors';
import { polishCount } from '../utils/polishPlural';
import { NAV_ITEMS } from './navItems';

// ---------------------------------------------------------------------------
// Szybkie akcje
// ---------------------------------------------------------------------------

/** WYŁĄCZNIE czynności, które aplikacja już ma: nowe zadanie + nawigacja. */
export type QuickActionRun = { kind: 'new-task' } | { kind: 'navigate'; path: string };

export interface QuickAction {
  id: string;
  label: string;
  /** Druga linia wiersza (podpowiedź, nie druga akcja). */
  hint: string;
  /** Dodatkowe hasła dopasowania poza etykietą. */
  keywords: string[];
  run: QuickActionRun;
}

/** Prefiks trybu „tylko szybkie akcje” (jak w paletach poleceń edytorów). */
export const QUICK_ACTION_PREFIX = '>';

/** Ile akcji pokazuje paleta obok zwykłych wyników (tryb `>` pokazuje wszystkie). */
export const QUICK_ACTIONS_INLINE_LIMIT = 4;

/**
 * Minimalna długość frazy, przy której akcje mieszają się ze zwykłymi wynikami.
 * Jedna litera pasuje do niemal każdej etykiety nawigacji, więc taka podpowiedź
 * byłaby samym szumem nad realnymi wynikami. Tryb `>` limitu nie ma.
 */
export const QUICK_ACTIONS_MIN_TERM = 2;

export function isQuickActionQuery(query: string): boolean {
  return query.trimStart().startsWith(QUICK_ACTION_PREFIX);
}

/** Fraza po zdjęciu prefiksu `>` (bez prefiksu zwraca po prostu przyciętą frazę). */
export function quickActionTerm(query: string): string {
  const trimmed = query.trimStart();
  return (trimmed.startsWith(QUICK_ACTION_PREFIX) ? trimmed.slice(1) : trimmed).trim();
}

/**
 * Katalog akcji. Nawigacja bierze etykiety z `NAV_ITEMS` (jedno źródło z
 * sidebarem), a bramkowane trasy `/admin` i `/team` wypadają tak samo jak w
 * menu — to bramka UX, nie granica bezpieczeństwa (trasa i tak przekierowuje).
 */
export function quickActionCatalog(opts: {
  canAdmin: boolean;
  canTeam: boolean;
}): QuickAction[] {
  const navigation: QuickAction[] = NAV_ITEMS.filter(
    ([path]) => (path !== '/admin' || opts.canAdmin) && (path !== '/team' || opts.canTeam),
  ).map(([path, label]) => ({
    id: `nav:${path}`,
    label: `Przejdź do: ${label}`,
    hint: 'Nawigacja',
    keywords: [label, path, 'przejdz', 'otworz widok'],
    run: { kind: 'navigate', path },
  }));

  return [
    {
      id: 'new-task',
      label: 'Nowe zadanie',
      hint: 'Otwiera formularz nowego zadania',
      keywords: ['nowe zadanie', 'dodaj zadanie', 'utworz zadanie', 'zadanie'],
      run: { kind: 'new-task' },
    },
    ...navigation,
  ];
}

/**
 * Dopasowanie akcji po etykiecie LUB haśle (normalizacja jak w `searchAll`).
 * Pusta fraza zwraca początek katalogu — paleta bez wpisanego tekstu pokazuje
 * kilka domyślnych akcji, a tryb `>` z pustą frazą całą listę (limit `Infinity`).
 */
export function filterQuickActions(
  term: string,
  catalog: readonly QuickAction[],
  limit: number = QUICK_ACTIONS_INLINE_LIMIT,
): QuickAction[] {
  const max = limit === Number.POSITIVE_INFINITY ? catalog.length : Math.max(0, Math.floor(limit));
  const q = normalizeSearchText(term.trim());
  if (q === '') return catalog.slice(0, max);
  const out: QuickAction[] = [];
  for (const action of catalog) {
    if (out.length >= max) break;
    const hit =
      normalizeSearchText(action.label).includes(q) ||
      action.keywords.some((k) => normalizeSearchText(k).includes(q));
    if (hit) out.push(action);
  }
  return out;
}

/**
 * Akcje pokazywane NAD zwykłymi wynikami. Pusta fraza => kilka domyślnych akcji
 * (paleta zaraz po otwarciu), jedna litera => nic (sam szum), dalej normalny
 * filtr z limitem `QUICK_ACTIONS_INLINE_LIMIT`.
 */
export function inlineQuickActions(
  term: string,
  catalog: readonly QuickAction[],
): QuickAction[] {
  const t = term.trim();
  if (t !== '' && t.length < QUICK_ACTIONS_MIN_TERM) return [];
  return filterQuickActions(t, catalog, QUICK_ACTIONS_INLINE_LIMIT);
}

// ---------------------------------------------------------------------------
// Podświetlanie dopasowania
// ---------------------------------------------------------------------------

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Mapa indeksów: znormalizowany tekst + dla każdego jego znaku indeks znaku
 * ŹRÓDŁOWEGO. Normalizujemy znak po znaku, bo `Ł`/`ą` potrafią zmienić długość
 * po NFD — bez tej mapy podświetlenie przesunęłoby się o kombinujące znaki.
 */
function normalizedWithMap(text: string): { norm: string; origin: number[] } {
  let norm = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = normalizeSearchText(text[i]);
    for (let k = 0; k < piece.length; k += 1) origin.push(i);
    norm += piece;
  }
  return { norm, origin };
}

/**
 * Tekst pocięty na fragmenty dopasowane / niedopasowane do frazy. Dopasowania są
 * rozłączne i liczone na tekście ZNORMALIZOWANYM (`zolty` podświetla `Żółty`),
 * ale zwracane fragmenty są wycinkami ORYGINAŁU. Brak frazy albo brak trafienia
 * => jeden fragment `match: false` (pusty tekst => pusta lista).
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  if (text === '') return [];
  const q = normalizeSearchText(query.trim());
  if (q === '') return [{ text, match: false }];

  const { norm, origin } = normalizedWithMap(text);
  const segments: HighlightSegment[] = [];
  let cursor = 0; // indeks w ORYGINALE
  let from = 0; // indeks w tekście znormalizowanym
  for (;;) {
    const hit = norm.indexOf(q, from);
    if (hit === -1) break;
    const start = origin[hit];
    const end = origin[hit + q.length - 1] + 1;
    // Dopasowanie zachodzące na poprzednie (znak źródłowy dający kilka znaków
    // znormalizowanych) pomijamy — fragmenty muszą zostać rozłączne.
    if (start < cursor) {
      from = hit + q.length;
      continue;
    }
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    // Puste dopasowanie nie może się zdarzyć (`q !== ''`), ale zabezpiecza pętlę.
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
    from = hit + q.length;
  }
  if (segments.length === 0) return [{ text, match: false }];
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

// ---------------------------------------------------------------------------
// Komunikat dla czytnika ekranu
// ---------------------------------------------------------------------------

/**
 * „12 wyników w 3 grupach”. Liczy tylko grupy NIEPUSTE; brak wyników ma własny
 * komunikat, żeby czytnik nie czytał „0 wyników w 0 grupach”.
 */
export function resultsAnnouncement(counts: readonly number[]): string {
  const total = counts.reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
  if (total === 0) return 'Brak wyników';
  const groups = counts.filter((n) => n > 0).length;
  return (
    `${total} ${polishCount(total, 'wynik', 'wyniki', 'wyników')} ` +
    `w ${groups} ${polishCount(groups, 'grupie', 'grupach', 'grupach')}`
  );
}

// ---------------------------------------------------------------------------
// „Ostatnio otwarte”
// ---------------------------------------------------------------------------

export type PaletteRefKind = 'project' | 'task';

export interface PaletteRef {
  kind: PaletteRefKind;
  id: string;
}

/** Ile pozycji pokazuje sekcja „Ostatnio otwarte”. */
export const RECENT_LIMIT = 6;

const refKey = (ref: PaletteRef): string => `${ref.kind}:${ref.id}`;

// Pamięć SESJI (moduł, jak `dirtyRegistry`): co użytkownik otworzył z palety w
// tej karcie. ŻADNEJ nowej trwałości — po odświeżeniu zostaje sam dziennik
// aktywności, który i tak jest w stanie aplikacji.
let openedRefs: PaletteRef[] = [];

export function rememberOpenedRef(ref: PaletteRef): void {
  openedRefs = [ref, ...openedRefs.filter((r) => refKey(r) !== refKey(ref))].slice(0, RECENT_LIMIT);
}

export function openedRefsSnapshot(): readonly PaletteRef[] {
  return openedRefs;
}

/** Tylko dla testów — czyści pamięć sesji. */
export function resetOpenedRefs(): void {
  openedRefs = [];
}

/**
 * Ostatnio otwarte projekty/zadania: najpierw pamięć sesji palety (to, co
 * użytkownik naprawdę otworzył), potem dziennik aktywności ze stanu (najnowsze
 * wpisy `project`/`task`). Pozycje wskazujące na usuniętą encję odpadają, wynik
 * jest zdeduplikowany i przycięty do `limit`. Pure — bez `Date.now`.
 */
export function recentPaletteRefs(
  state: AppData,
  opened: readonly PaletteRef[] = openedRefsSnapshot(),
  limit: number = RECENT_LIMIT,
): PaletteRef[] {
  const max = Math.max(0, Math.floor(limit));
  if (max === 0) return [];
  const projectIds = new Set(state.projects.map((p) => p.id));
  const taskIds = new Set(state.tasks.map((t) => t.id));
  const exists = (ref: PaletteRef): boolean =>
    ref.kind === 'project' ? projectIds.has(ref.id) : taskIds.has(ref.id);

  const seen = new Set<string>();
  const out: PaletteRef[] = [];
  const push = (ref: PaletteRef): void => {
    const key = refKey(ref);
    if (seen.has(key) || !exists(ref)) return;
    seen.add(key);
    out.push(ref);
  };

  for (const ref of opened) {
    if (out.length >= max) return out;
    push(ref);
  }

  const fromLog = state.activity
    .filter((e) => e.entityType === 'project' || e.entityType === 'task')
    .slice()
    // Najnowsze najpierw; `id` jako tie-break trzyma kolejność deterministyczną.
    .sort((a, b) =>
      a.createdAt < b.createdAt
        ? 1
        : a.createdAt > b.createdAt
          ? -1
          : a.id < b.id
            ? 1
            : a.id > b.id
              ? -1
              : 0,
    );
  for (const entry of fromLog) {
    if (out.length >= max) break;
    push({ kind: entry.entityType as PaletteRefKind, id: entry.entityId });
  }
  return out;
}
