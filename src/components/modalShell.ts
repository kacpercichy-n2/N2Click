// Czysta logika powłoki modala: wybór pola startowego, krok pułapki fokusa,
// decyzja o zamknięciu kliknięciem w tło, kompensacja paska przewijania i
// licznik blokad scrolla. ZERO DOM-u — wejściem są lekkie deskryptory, więc
// całość testuje się w środowisku `node` (vitest.config.ts), a cienką warstwę
// `querySelectorAll` + `.focus()` trzyma hook `useModalShell.ts`.

/** Lekki opis kandydata na fokus (odwzorowanie jednego elementu z karty). */
export interface FocusCandidate {
  /** Element niesie `data-autofocus` — jawnie wskazane pole startowe. */
  autofocus?: boolean;
  /** Natywnie wyłączony (`:disabled`) — przeglądarka go nie sfokusuje. */
  disabled?: boolean;
  /** Wartość atrybutu `tabindex`; brak atrybutu = `undefined`. */
  tabIndex?: number;
  /** Element nie ma pudełka w layoucie (`display:none`, `hidden`, `type=hidden`). */
  hidden?: boolean;
}

/** Da się sfokusować programowo (także z `tabindex="-1"`). */
export function isFocusableCandidate(candidate: FocusCandidate): boolean {
  return candidate.disabled !== true && candidate.hidden !== true;
}

/** Wchodzi w naturalną kolejność Tab (czyli bez `tabindex="-1"`). */
export function isTabbableCandidate(candidate: FocusCandidate): boolean {
  return (
    isFocusableCandidate(candidate) && (candidate.tabIndex === undefined || candidate.tabIndex >= 0)
  );
}

/** Indeksy kandydatów wchodzących w cykl Tab, w kolejności DOM. */
export function tabbableIndexes(candidates: FocusCandidate[]): number[] {
  const result: number[] = [];
  candidates.forEach((candidate, index) => {
    if (isTabbableCandidate(candidate)) result.push(index);
  });
  return result;
}

/**
 * Pole startowe po otwarciu: najpierw pierwszy `data-autofocus` (o ile w ogóle
 * da się go sfokusować — wyłączone pole ustępuje), potem pierwszy element w
 * cyklu Tab. `null` znaczy „sfokusuj samą kartę” (dialog bez kontrolek).
 */
export function resolveInitialFocusIndex(candidates: FocusCandidate[]): number | null {
  const marked = candidates.findIndex((c) => c.autofocus === true && isFocusableCandidate(c));
  if (marked !== -1) return marked;
  const tabbable = tabbableIndexes(candidates);
  return tabbable.length > 0 ? tabbable[0] : null;
}

/**
 * Co zrobić z wciśniętym Tabem:
 * - `none` — środek listy, natywna kolejność przeglądarki jest poprawna,
 * - `card` — brak kontrolek, fokus zostaje na karcie (Tab nie wyprowadza),
 * - `focus` — trzeba przeskoczyć na wskazany indeks (zawinięcie albo powrót
 *   fokusa, który uciekł poza dialog).
 */
export type TrapAction = { type: 'none' } | { type: 'card' } | { type: 'focus'; index: number };

/**
 * Krok pułapki fokusa. `currentIndex === -1` to fokus POZA kartą (np. na
 * `<body>` po zamknięciu popovera) — wtedy wciągamy go z powrotem na pierwszy
 * (Tab) albo ostatni (Shift+Tab) element.
 */
export function resolveTrapAction(
  currentIndex: number,
  count: number,
  shift: boolean,
): TrapAction {
  if (count <= 0) return { type: 'card' };
  if (currentIndex < 0 || currentIndex >= count) {
    return { type: 'focus', index: shift ? count - 1 : 0 };
  }
  if (shift && currentIndex === 0) return { type: 'focus', index: count - 1 };
  if (!shift && currentIndex === count - 1) return { type: 'focus', index: 0 };
  return { type: 'none' };
}

/** Modyfikatory zdarzenia klawiatury (podzbiór `KeyboardEvent`). */
export interface TrapKeyEvent {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/** Pułapka reaguje wyłącznie na czysty Tab i Shift+Tab. */
export function shouldHandleTrapKey(event: TrapKeyEvent): boolean {
  if (event.key !== 'Tab') return false;
  return event.ctrlKey !== true && event.altKey !== true && event.metaKey !== true;
}

/**
 * Tło zamyka modal TYLKO wtedy, gdy zarówno `pointerdown`, jak i wynikające z
 * niego `click` trafiły w tło. Zaznaczanie tekstu zaczęte w karcie i skończone
 * na tle daje `click` na kontenerze (wspólny przodek), więc bez pary
 * niszczyłoby niezapisane zmiany.
 */
export function shouldCloseOnBackdrop(
  pointerDownOnBackdrop: boolean,
  clickOnBackdrop: boolean,
): boolean {
  return pointerDownOnBackdrop && clickOnBackdrop;
}

/**
 * Szerokość znikającego paska przewijania do skompensowania paddingiem.
 * Na nakładkowych paskach (macOS) wychodzi 0 i nic się nie dzieje.
 */
export function scrollbarCompensation(innerWidth: number, clientWidth: number): number {
  const gap = innerWidth - clientWidth;
  if (!Number.isFinite(gap) || gap <= 0) return 0;
  return gap;
}

/** Licznik blokad scrolla — zdejmuje blokadę dopiero przy zejściu do zera. */
export interface ScrollLockCounter {
  /** `true`, gdy to pierwsza blokada — dopiero wtedy zapisujemy i nadpisujemy styl. */
  acquire(): boolean;
  /** `true`, gdy to ostatnie zwolnienie — dopiero wtedy przywracamy styl. */
  release(): boolean;
  /** Liczba aktywnych blokad (do testów i diagnostyki). */
  count(): number;
}

/**
 * Fabryka licznika. Moduł DOM-owy trzyma JEDNĄ instancję na aplikację, żeby
 * nałożone na siebie modale nie przywracały `overflow` jeden po drugim.
 * Niesparowane `release()` jest bezpieczne: licznik nie schodzi poniżej zera i
 * nie zgłasza przywrócenia stylu drugi raz.
 */
export function createScrollLockCounter(): ScrollLockCounter {
  let locks = 0;
  return {
    acquire() {
      locks += 1;
      return locks === 1;
    },
    release() {
      if (locks === 0) return false;
      locks -= 1;
      return locks === 0;
    },
    count() {
      return locks;
    },
  };
}
