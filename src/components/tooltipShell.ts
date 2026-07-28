// Czysta logika dymków podpowiedzi (tooltipów): opóźnienie grupowe, decyzja
// „pokazać / schować" dla nazwanego zdarzenia oraz kontrakt dostępności
// (kiedy tekst dymka NAPRAWDĘ coś dodaje do nazwy kontrolki).
//
// ZERO DOM-u — wejściem są nazwy zdarzeń, znaczniki czasu i teksty, więc całość
// testuje się w środowisku `node` (vitest.config.ts zbiera tylko
// `src/**/*.test.ts`). Cienką warstwę (portal, pomiary, nasłuchy okna) trzyma
// `Tooltip.tsx`.
//
// Bliźniaki: `overlayShell.ts` / `useOverlay.ts`, `modalShell.ts` /
// `useModalShell.ts`, `fieldContract.ts` / `Field.tsx` — ten sam podział ról.

/** Ile czeka PIERWSZY dymek po „zimnym" wskaźniku. */
export const TOOLTIP_OPEN_DELAY_MS = 500;
/** Jak długo po schowaniu dymka grupa zostaje „ciepła" (kolejny bez zwłoki). */
export const TOOLTIP_WARM_GRACE_MS = 500;

/**
 * Stan opóźnienia grupowego. JEDNA grupa na aplikację: gdy użytkownik już
 * czyta podpowiedzi, kolejne pojawiają się natychmiast; po przerwie dłuższej
 * niż `TOOLTIP_WARM_GRACE_MS` grupa stygnie i znów obowiązuje pełna zwłoka.
 */
export interface TooltipGroup {
  /** Ile dymków jest AKTUALNIE pokazanych (zwykle 0 albo 1). */
  shown: number;
  /** Znacznik czasu ostatniego schowania; `null` = jeszcze nic nie było. */
  lastHideAt: number | null;
}

export function createTooltipGroup(): TooltipGroup {
  return { shown: 0, lastHideAt: null };
}

/** Ciepła grupa = coś jest pokazane ALBO ostatnie schowanie było niedawno. */
export function isTooltipGroupWarm(group: TooltipGroup, now: number): boolean {
  if (group.shown > 0) return true;
  if (group.lastHideAt === null) return false;
  return now - group.lastHideAt < TOOLTIP_WARM_GRACE_MS;
}

/** Zwłoka przed pokazaniem: pełna dla zimnej grupy, zerowa dla ciepłej. */
export function resolveShowDelay(group: TooltipGroup, now: number): number {
  return isTooltipGroupWarm(group, now) ? 0 : TOOLTIP_OPEN_DELAY_MS;
}

/** Odnotowanie pokazania dymka (grupa staje się ciepła). `now` jest przyjmowany
 *  dla symetrii z `noteHide` — pokazany dymek grzeje grupę sam z siebie. */
export function noteShow(group: TooltipGroup, _now: number): void {
  group.shown += 1;
}

/** Odnotowanie schowania dymka — od tej chwili biegnie okno łaski. */
export function noteHide(group: TooltipGroup, now: number): void {
  group.shown = Math.max(0, group.shown - 1);
  group.lastHideAt = now;
}

/** Zdarzenie wyzwalacza w postaci czystych danych (bez obiektów DOM). */
export type TooltipTriggerEvent =
  | { readonly type: 'pointerenter'; readonly pointerType: string }
  | { readonly type: 'pointerleave' }
  | { readonly type: 'pointerdown' }
  | { readonly type: 'focus'; readonly focusVisible: boolean }
  | { readonly type: 'blur' }
  | { readonly type: 'keydown'; readonly key: string };

/** Decyzja powłoki: nic, zaplanuj pokazanie po `delayMs`, albo schowaj teraz. */
export type TooltipAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'show'; readonly delayMs: number }
  | { readonly kind: 'hide' };

const NONE: TooltipAction = { kind: 'none' };
const HIDE: TooltipAction = { kind: 'hide' };

/**
 * Reguły są celowo ostre:
 * - wskaźnik dotykowy/rysik NIGDY nie pokazuje dymka (długie przytrzymanie
 *   otwiera menu systemowe, a dymek zasłaniałby cel dotknięcia),
 * - fokus liczy się TYLKO jako `:focus-visible` (klik myszą w przycisk nie ma
 *   zapalać dymka po aktywacji) i wtedy pokazuje się BEZ zwłoki — użytkownik
 *   klawiatury nie ma jak „przeczekać" opóźnienia,
 * - `pointerdown` chowa: aktywacja jest ważniejsza niż podpowiedź,
 * - Escape chowa dymek (bez konsumowania klawisza — patrz `Tooltip.tsx`).
 */
export function resolveTooltipTrigger(
  event: TooltipTriggerEvent,
  group: TooltipGroup,
  now: number,
): TooltipAction {
  switch (event.type) {
    case 'pointerenter':
      if (event.pointerType !== 'mouse') return NONE;
      return { kind: 'show', delayMs: resolveShowDelay(group, now) };
    case 'focus':
      return event.focusVisible ? { kind: 'show', delayMs: 0 } : NONE;
    case 'pointerleave':
    case 'pointerdown':
    case 'blur':
      return HIDE;
    case 'keydown':
      return event.key === 'Escape' ? HIDE : NONE;
    default:
      return NONE;
  }
}

/** Porównanie tekstów „po ludzku": bez skrajnych spacji, bez wielkości liter. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');
}

/**
 * Czy dymek wnosi treść PONAD nazwę dostępną kontrolki?
 *
 * Czytnik ekranu ogłasza nazwę i opis po kolei, więc `aria-label="Usuń"` +
 * `aria-describedby` → „Usuń" daje podwójne „Usuń, Usuń". Dlatego opis
 * podpinamy WYŁĄCZNIE wtedy, gdy tekst dymka nie jest zawarty w nazwie.
 * Dymek nadal jest wtedy widoczny — po prostu jest czysto wizualny.
 */
export function tooltipDescribes(accessibleName: string, tooltipText: string): boolean {
  const tip = normalize(tooltipText);
  if (tip === '') return false;
  const name = normalize(accessibleName);
  if (name === '') return true;
  return !name.includes(tip);
}

/**
 * Tekst dla UKRYTEGO opisu: skrót klawiszowy dopisany słownie, bo czytnik
 * ekranu nie zobaczy wizualnego `<kbd>` w karcie dymka (ta jest `aria-hidden`).
 */
export function buildTooltipText(text: string, shortcut?: string | null): string {
  const base = text.trim();
  const key = (shortcut ?? '').trim();
  if (key === '') return base;
  if (base === '') return `skrót: ${key}`;
  return `${base} (skrót: ${key})`;
}

/**
 * Scalenie `aria-describedby` — kontrolka może mieć już własne opisy (pole
 * formularza z podpowiedzią i błędem), a dymek tylko dokłada swoje `id`.
 * Duplikaty znikają, kolejność istniejących opisów zostaje.
 */
export function mergeDescribedBy(existing: string | undefined, id: string): string {
  const parts = (existing ?? '').split(/\s+/).filter((token) => token !== '');
  parts.push(id);
  return [...new Set(parts)].join(' ');
}
