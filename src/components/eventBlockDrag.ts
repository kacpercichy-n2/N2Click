// Czysty model PRZECIĄGANIA I ROZCIĄGANIA kafelka wydarzenia (`.week-event-block`)
// w widoku tygodnia/dnia. Bez Reacta, bez DOM-u i bez store'u — dokładnie tak, jak
// `calendarBlockKeyboard.ts` trzyma model klawiaturowej edycji bloku zadania —
// więc całość testuje się w środowisku `node` (vitest.config.ts).
//
// Powód istnienia: spotkanie dało się dotąd wyłącznie otworzyć (klik/Enter).
// Przestawienie go wymagało modala. Teraz kafelek jedzie za wskaźnikiem, a
// KAŻDA zmiana przechodzi przez okno potwierdzenia — bo wydarzenie jest wspólne
// i przesunięcie go dotyka wszystkich uczestników naraz.
//
// Model jest DODATKOWYM WEJŚCIEM do istniejącej akcji `SAVE_EVENT` (inwariant 6:
// żadnej nowej akcji reduktora). Ten moduł niczego nie wysyła — liczy projekcję
// i buduje polskie teksty; wysyłkę i bramkę kolizji trzyma WeekView.
//
// Granice geometrii (lustro `utils/time.ts`, te same, co przy bloku zadania):
//  - start i długość zawsze na siatce 15 minut (`snapToStep`),
//  - start w [0, 1440 - długość] (`clampBlockStart`),
//  - długość w [15, 1440 - start],
//  - uchwyt górny przesuwa START i trzyma KONIEC; dolny trzyma START,
//  - wydarzenie CYKLICZNE nigdy nie zmienia dnia (kotwica serii musi zostać
//    w swoim dniu tygodnia — inaczej `canonicalEventRecurrence` odrzuci draft).
import { DAY_MINUTES, MINUTE_STEP, clampBlockStart, formatMinutes, snapToStep } from '../utils/time';
import { formatShortWithWeekday } from '../utils/dates';

/** Tryb gestu: całe ciało kafelka albo jeden z dwóch uchwytów krawędzi. */
export type EventDragMode = 'move' | 'top' | 'bottom';

/** Zapisana pozycja wystąpienia, od której liczy się projekcja. */
export interface EventDragBase {
  startMinutes: number;
  durationMinutes: number;
  /** Indeks kolumny dnia (0 w widoku dnia, 0-6 w tygodniu). */
  dayIndex: number;
}

/** Wystawiona (jeszcze niezapisana) pozycja wystąpienia. */
export interface EventProjection {
  startMinutes: number;
  durationMinutes: number;
  dayIndex: number;
}

export interface EventDragInput {
  mode: EventDragMode;
  /** Surowe przesunięcie pionowe w minutach (przed snapem). */
  deltaMinutes: number;
  /** Przesunięcie w kolumnach dnia; uchwyty krawędzi zawsze podają 0. */
  dayDelta: number;
  /** Liczba WYRENDEROWANYCH kolumn dnia (`days.length`). */
  dayCount: number;
  /** Wydarzenie cykliczne: dzień jest nieprzesuwalny (patrz nagłówek). */
  recurring: boolean;
}

/**
 * Projekcja gestu. Czysta funkcja jednego kroku: liczy się ZAWSZE od zapisanej
 * pozycji (`base`) i pełnego przesunięcia wskaźnika, więc powrót kursora na
 * punkt startowy oddaje dokładnie pozycję wyjściową (bez dryfu kumulacyjnego).
 */
export function projectEventDrag(base: EventDragBase, input: EventDragInput): EventProjection {
  const delta = snapToStep(input.deltaMinutes);
  const baseEnd = base.startMinutes + base.durationMinutes;

  if (input.mode === 'top') {
    // Uchwyt górny: KONIEC stoi, start jedzie; minimum jeden krok (15 min).
    const startMinutes = Math.max(0, Math.min(base.startMinutes + delta, baseEnd - MINUTE_STEP));
    return { startMinutes, durationMinutes: baseEnd - startMinutes, dayIndex: base.dayIndex };
  }

  if (input.mode === 'bottom') {
    // Uchwyt dolny: START stoi, koniec jedzie; sufit 24:00.
    const end = Math.max(
      base.startMinutes + MINUTE_STEP,
      Math.min(baseEnd + delta, DAY_MINUTES),
    );
    return {
      startMinutes: base.startMinutes,
      durationMinutes: end - base.startMinutes,
      dayIndex: base.dayIndex,
    };
  }

  // Przeniesienie: długość nietykalna, start mieści się w dobie, dzień clampuje
  // się do widocznych kolumn (a przy serii w ogóle się nie rusza).
  return {
    startMinutes: clampBlockStart(base.startMinutes + delta, base.durationMinutes),
    durationMinutes: base.durationMinutes,
    dayIndex: input.recurring
      ? base.dayIndex
      : Math.max(0, Math.min(input.dayCount - 1, base.dayIndex + input.dayDelta)),
  };
}

/** Czy projekcja różni się od zapisanej pozycji? `false` = nie ma o co pytać. */
export function eventProjectionChanged(base: EventDragBase, proj: EventProjection): boolean {
  return (
    proj.startMinutes !== base.startMinutes ||
    proj.durationMinutes !== base.durationMinutes ||
    proj.dayIndex !== base.dayIndex
  );
}

/**
 * Data zapisywana do `CalendarEvent` — NIE ta, którą widać na kafelku.
 *
 * Wydarzenie CYKLICZNE ma JEDNĄ kotwicę (`event.date`) i tyle kafelków, ile
 * wystąpień w oglądanym tygodniu. Zapisanie dnia PRZECIĄGANEGO WYSTĄPIENIA
 * przestawiłoby kotwicę serii, a `expandOccurrences` traktuje ją jako TWARDĄ
 * dolną granicę (`lower = from < anchorStart ? anchorStart : from`) i liczy od
 * jej tygodnia fazę `intervalWeeks`. Przeciągnięcie środowego kafelka serii
 * zakotwiczonej w poniedziałek UCIĘŁOBY więc wszystkie wcześniejsze wystąpienia
 * i przesunęło rytm co-N-tygodni. Seria zostaje przy swojej kotwicy; zmienia
 * się wyłącznie czas (reduktor wymusza go na regule). Wydarzenie jednorazowe
 * zapisuje dzień docelowy, bo jego kotwica JEST jego jedynym terminem.
 */
export function eventDragDraftDate(
  projectedDate: string,
  eventDate: string,
  recurring: boolean,
): string {
  return recurring ? eventDate : projectedDate;
}

// ---------------------------------------------------------------------------
// Klawiatura — DRUGIE wejście do tej samej projekcji
// ---------------------------------------------------------------------------
// Świadomie WŁASNY, minutowy automat zamiast `blockKeyboardReducer`: tamten
// mówi godzinami dziesiętnymi (`plannedHours`), liczy kolizje sąsiadów i sufit
// budżetu zadania — trzy rzeczy, których wydarzenie nie ma. Wciskanie go tutaj
// z atrapami (`blocksOnDay: () => []`, `maxHours` liczony z doby) czyniłoby oba
// modele trudniejszymi do czytania niż ten tuzin linijek.

export interface EventKeyboardContext {
  base: EventDragBase;
  dayCount: number;
  recurring: boolean;
}

export type EventKeyboardEvent =
  | { type: 'move'; deltaMinutes: number }
  | { type: 'resize'; deltaMinutes: number }
  | { type: 'day'; delta: number };

function sameProjection(a: EventProjection, b: EventProjection): boolean {
  return (
    a.startMinutes === b.startMinutes &&
    a.durationMinutes === b.durationMinutes &&
    a.dayIndex === b.dayIndex
  );
}

/**
 * Reduktor wystawionej edycji. Jak `blockKeyboardReducer` i reduktor store'u
 * (inwariant 6): zdarzenie BEZ SKUTKU zwraca TĘ SAMĄ referencję — warstwa
 * Reactowa czyta z tego „czy w ogóle jest co ogłaszać". `null` = nic nie jest
 * wystawione; pierwsze skuteczne zdarzenie wchodzi w tryb.
 */
export function eventKeyboardReducer(
  state: EventProjection | null,
  event: EventKeyboardEvent,
  ctx: EventKeyboardContext,
): EventProjection | null {
  const from: EventProjection = state ?? { ...ctx.base };
  let { startMinutes, durationMinutes, dayIndex } = from;

  if (event.type === 'move') {
    startMinutes = clampBlockStart(snapToStep(startMinutes + event.deltaMinutes), durationMinutes);
  } else if (event.type === 'resize') {
    const rawEnd = startMinutes + durationMinutes + event.deltaMinutes;
    const end = Math.max(startMinutes + MINUTE_STEP, Math.min(snapToStep(rawEnd), DAY_MINUTES));
    durationMinutes = end - startMinutes;
  } else {
    if (ctx.recurring) return state; // seria zostaje w swoim dniu tygodnia
    dayIndex = Math.max(0, Math.min(ctx.dayCount - 1, dayIndex + event.delta));
  }

  const next: EventProjection = { startMinutes, durationMinutes, dayIndex };
  if (state !== null) return sameProjection(state, next) ? state : next;
  return sameProjection(next, ctx.base) ? state : next;
}

// ---------------------------------------------------------------------------
// Polskie teksty (okno potwierdzenia + region `aria-live`)
// ---------------------------------------------------------------------------
// Zakresy godzin ZWYKŁYM łącznikiem („10:00-11:30") — myślnik i półpauza są
// zabronione w tekstach widocznych dla użytkownika.

/** Jedno zdanie, dla którego całe okno w ogóle istnieje. */
export const EVENT_DRAG_GLOBAL_SENTENCE =
  'Zmiana obowiązuje globalnie - dla wszystkich uczestników i każdego, kto widzi ten kalendarz.';

/** Dopisek dla wydarzenia cyklicznego: gest rusza CAŁĄ serią, nie wystąpieniem. */
export const EVENT_DRAG_SERIES_SENTENCE = 'Dotyczy całej serii wydarzenia.';

/** Termin wystąpienia do zdania: dzień + zakres godzin. */
export interface EventMoment {
  date: string;
  startMinutes: number;
  durationMinutes: number;
}

function rangePhrase(m: EventMoment): string {
  return `${formatMinutes(m.startMinutes)}-${formatMinutes(m.startMinutes + m.durationMinutes)}`;
}

function momentPhrase(m: EventMoment): string {
  return `${formatShortWithWeekday(m.date)} ${rangePhrase(m)}`;
}

/**
 * Czy to przeniesienie, czy zmiana czasu trwania? Uchwyt górny rusza start ORAZ
 * długość, więc o rodzaju decyduje DŁUGOŚĆ, nie tryb gestu — i tę samą funkcję
 * może użyć klawiatura, która trybu nie ma.
 */
export function eventDragKind(from: EventMoment, to: EventMoment): 'move' | 'resize' {
  return from.durationMinutes !== to.durationMinutes ? 'resize' : 'move';
}

export interface EventDragConfirmInput {
  /** Tytuł do pokazania (maska utajnienia liczona przez wołającego). */
  title: string;
  from: EventMoment;
  to: EventMoment;
  recurring: boolean;
  /** JEDNO zdanie o kolizjach nieblokujących; '' = nie ma o czym mówić. */
  conflictSentence?: string;
}

/** Opcje dla `useConfirm()` — kształt `ConfirmOptions` bez importu Reacta. */
export interface EventDragConfirmCopy {
  title: string;
  description: string;
  consequences: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * Treść okna potwierdzenia. Tytuł zadaje PYTANIE, opis pokazuje „z … na …",
 * a zdanie o skutkach zawsze mówi wprost, że zmiana jest GLOBALNA (i dla serii
 * — że dotyczy wszystkich jej wystąpień). `tone` zostaje domyślny: to nie jest
 * operacja nieodwracalna.
 */
export function eventDragConfirmCopy(input: EventDragConfirmInput): EventDragConfirmCopy {
  const kind = eventDragKind(input.from, input.to);
  const consequences = [
    EVENT_DRAG_GLOBAL_SENTENCE,
    input.recurring ? EVENT_DRAG_SERIES_SENTENCE : '',
    (input.conflictSentence ?? '').trim(),
  ]
    .filter((part) => part !== '')
    .join(' ');
  return {
    title: kind === 'move' ? 'Przenieść wydarzenie?' : 'Zmienić czas trwania wydarzenia?',
    description: `„${input.title}”: z ${momentPhrase(input.from)} na ${momentPhrase(input.to)}.`,
    consequences,
    confirmLabel: 'Zmień dla wszystkich',
    cancelLabel: 'Anuluj',
  };
}

/** Nazwa dostępna kafelka — podąża za WYSTAWIONĄ projekcją, więc nie kłamie. */
export function eventBlockAriaLabel(title: string, at: EventMoment, editable: boolean): string {
  const base = `Wydarzenie: ${title}, ${momentPhrase(at)}.`;
  return editable ? `${base} Przeciągnij, aby przenieść; przeciągnij krawędź, aby zmienić czas trwania.` : base;
}

/** Wejście w klawiaturową edycję: mówi CO się edytuje i GDZIE kafelek stoi. */
export function eventEditAnnouncement(title: string, to: EventMoment): string {
  return `Edycja wydarzenia: ${title}. Cel: ${momentPhrase(to)}.`;
}

/** Każdy kolejny cel wystawionej edycji. */
export function eventTargetAnnouncement(to: EventMoment): string {
  return `Cel: ${momentPhrase(to)}.`;
}

/**
 * Zmiana WESZŁA DO STANU aplikacji (reduktor ją przyjął). Świadomie NIE mówi
 * „Zapisano": w tym projekcie to słowo jest zarezerwowane dla POTWIERDZONEGO
 * zapisu do pamięci — `useSaveStatus` stawia etykietę „Zapisano HH:mm" dopiero
 * po 350 ms i tylko gdy `persistFailed` jest fałszywe, bo nieudany zapis NIGDY
 * nie może zameldować sukcesu (CLAUDE.md, „A failed save must never report
 * `Zapisano`"). Reduktor commituje SYNCHRONICZNIE, a zapis do localStorage leci
 * dopiero w efekcie i potrafi paść (quota, tryb prywatny) — ogłoszenie w tym
 * takcie może więc uczciwie powiedzieć tylko, CO widać na siatce. Za nieudany
 * zapis odpowiada trwały `PersistenceBanner` (i jego własne ogłoszenie), a za
 * nieudany zapis w chmurze istniejący baner synchronizacji.
 */
export function eventAppliedAnnouncement(
  title: string,
  from: EventMoment,
  to: EventMoment,
): string {
  const what =
    eventDragKind(from, to) === 'move' ? 'Przeniesiono' : 'Zmieniono czas trwania';
  return `${what}: ${title}, ${momentPhrase(to)}.`;
}

/** Użytkownik anulował w oknie potwierdzenia (albo Escape) — nic nie poszło. */
export function eventCancelAnnouncement(title: string): string {
  return `Anulowano. „${title}” zostaje bez zmian.`;
}

/** Wystawiona edycja cofnięta Escapem lub wyjściem fokusa. */
export function eventRevertAnnouncement(title: string, base: EventMoment): string {
  return `Anulowano edycję. „${title}” wraca na ${momentPhrase(base)}.`;
}

/** Zapis odrzucony (kolizja blokująca albo odmowa reduktora) — z powodem. */
export function eventRejectedAnnouncement(reason: string): string {
  const tail = reason.trim();
  return tail === '' ? 'Nie zapisano zmiany wydarzenia.' : `Nie zapisano. ${tail}`;
}

/** Zapis odrzucony przez reduktor bez rozpoznanej kolizji — jedno zdanie. */
export const EVENT_DRAG_REDUCER_REJECT =
  'Nie da się ustawić wydarzenia w tych godzinach.';
