// Czysty automat KLAWIATUROWEJ edycji bloku kalendarza — odpowiednik
// przeciągania wskaźnikiem. Bez Reacta i bez dostępu do store'u (wzorzec
// `kanbanMove.ts` / `touchDrag.ts`), więc całość testuje się bez DOM-u.
//
// Powód istnienia: kafelek `.week-block` reagował na Enter/spację (otwarcie
// zadania) i na nic więcej — przenieść, rozciągnąć ani odesłać bloku do
// zasobnika nie dało się inaczej niż myszą.
//
// Model: klawiatura jest DODATKOWYM WEJŚCIEM do tego samego modelu, nigdy
// osobnym, uproszczonym. Automat trzyma WYSTAWIONĄ (staged) projekcję — dokładnie
// tak, jak `dragRef`/`drag` trzyma projekcję wskaźnika — i przepuszcza ją przez
// TE SAME funkcje z `utils/time.ts`, co upuszczenie: `snapToStep`,
// `clampBlockStart`, granicę doby i limit budżetu (`maxHours`). Kolizja tej samej
// osoby BLOKUJE zatwierdzenie tak samo, jak blokuje upuszczenie (inwariant 3).
// Automat sam niczego nie wysyła — zwraca intencję o kształcie ładunku
// `SET_BLOCK_TIME` (inwariant 6: żadnej nowej akcji reduktora).
import {
  DAY_MINUTES,
  MINUTE_STEP,
  blockEndMinutes,
  clampBlockStart,
  formatMinutes,
  hoursToMinutes,
  minutesToHours,
  rangesOverlap,
  snapToStep,
} from '../utils/time';
import { blockLabel } from '../utils/blockLabel';

/** Sąsiad z tego samego dnia i tej samej osoby — źródło kolizji + jej opisu. */
export interface BlockKeyboardNeighbor {
  id: string;
  startMinutes: number;
  plannedHours: number;
  /** Tytuł zadania; używany WYŁĄCZNIE w zdaniu o kolizji. */
  title: string;
}

/** Niezmienne otoczenie edycji — zbierane RAZ przy wejściu w tryb, jak
 *  `startDrag` zbiera `colWidth` i `maxHours` na starcie przeciągania. */
export interface BlockKeyboardContext {
  entryId: string;
  baseStart: number;
  baseHours: number;
  baseDayIndex: number;
  /** Liczba kolumn dnia (7 w widoku tygodnia) — strzałki NIE zawijają. */
  dayCount: number;
  /** Sufit rozciągania: `baseHours + growAllowanceHours` (jak przy przeciąganiu). */
  maxHours: number;
  /** Bloki tej samej osoby w danej kolumnie dnia (indeks per (osoba, data)). */
  blocksOnDay: (dayIndex: number) => readonly BlockKeyboardNeighbor[];
}

/** `null` = nic nie jest wystawione; blok siedzi na zapisanej pozycji. */
export interface BlockKeyboardState {
  projStart: number;
  projHours: number;
  projDayIndex: number;
  /** Kolizja z inną pracą tej osoby → zatwierdzenie jest zablokowane. */
  colliding: boolean;
  /** Rozciąganie oparło się o limit godzin zadania (projekcja przycięta). */
  atCap: boolean;
}

export type BlockKeyboardEvent =
  | { type: 'move'; deltaMinutes: number }
  | { type: 'resize'; deltaMinutes: number }
  | { type: 'day'; delta: number }
  | { type: 'cancel' };

/** Intencja zapisu — DOKŁADNIE ładunek istniejącej akcji `SET_BLOCK_TIME`. */
export interface BlockKeyboardCommit {
  entryId: string;
  dayIndex: number;
  startMinutes: number;
  plannedHours: number;
}

/** Geometria bloku do zdań ogłoszeń (data + start + długość). */
export interface BlockGeometry {
  date: string;
  startMinutes: number;
  plannedHours: number;
}

/** Projekcja startowa = zapisana pozycja bloku (nic jeszcze nie ruszone). */
export function initialBlockKeyboardState(ctx: BlockKeyboardContext): BlockKeyboardState {
  return {
    projStart: ctx.baseStart,
    projHours: ctx.baseHours,
    projDayIndex: ctx.baseDayIndex,
    colliding: false,
    atCap: false,
  };
}

/**
 * Pierwszy blok kolidujący z zakresem — ten sam predykat, co `hasCollision`
 * (`rangesOverlap`, stykające się krawędzie NIE kolidują), tylko zwracający
 * WINOWAJCĘ, żeby dało się o nim powiedzieć zdaniem, a nie samą czerwoną obwódką.
 */
export function findBlockConflict(
  blocks: readonly BlockKeyboardNeighbor[],
  start: number,
  durationMin: number,
  excludeId: string,
): BlockKeyboardNeighbor | null {
  const end = start + durationMin;
  for (const b of blocks) {
    if (b.id === excludeId) continue;
    if (rangesOverlap(start, end, b.startMinutes, blockEndMinutes(b.startMinutes, b.plannedHours))) {
      return b;
    }
  }
  return null;
}

function sameProjection(a: BlockKeyboardState, b: BlockKeyboardState): boolean {
  return (
    a.projStart === b.projStart &&
    a.projHours === b.projHours &&
    a.projDayIndex === b.projDayIndex &&
    a.colliding === b.colliding &&
    a.atCap === b.atCap
  );
}

/**
 * Reduktor wystawionej edycji. Jak `kanbanMoveReducer` i reduktor store'u
 * (inwariant 6): zdarzenie BEZ SKUTKU zwraca TĘ SAMĄ referencję stanu — warstwa
 * Reactowa czyta z tego „czy w ogóle jest co ogłaszać”. Pierwsze skuteczne
 * zdarzenie przy `state === null` WCHODZI w tryb (podniesienie jest domyślne,
 * bo blok jest już fokusowalny i nie ma osobnego uchwytu).
 *
 * Granice, wszystkie z `utils/time.ts` — te same, których używa upuszczenie:
 * - przesunięcie: `snapToStep` + `clampBlockStart` (blok mieści się w dobie),
 * - rozciąganie: krok 15 min od dołu, minimum jeden krok, koniec ≤ 24:00,
 *   sufit `maxHours` (`atCap`),
 * - dzień: clamp do [0, dayCount-1] BEZ zawijania,
 * - kolizja tej samej osoby liczona po każdej zmianie (blokuje zatwierdzenie).
 */
export function blockKeyboardReducer(
  state: BlockKeyboardState | null,
  event: BlockKeyboardEvent,
  ctx: BlockKeyboardContext,
): BlockKeyboardState | null {
  if (event.type === 'cancel') return state === null ? state : null;

  const from = state ?? initialBlockKeyboardState(ctx);
  let projStart = from.projStart;
  let projHours = from.projHours;
  let projDayIndex = from.projDayIndex;
  let atCap = false;

  if (event.type === 'move') {
    // Przesunięcie zmienia WYŁĄCZNIE start; długość jest nietykalna, więc clamp
    // dobowy liczy się z aktualnego czasu trwania (jak w trybie `move` dragu).
    projStart = clampBlockStart(snapToStep(projStart + event.deltaMinutes), hoursToMinutes(projHours));
  } else if (event.type === 'resize') {
    // Rozciąganie od DOŁU (start stoi) — odpowiednik uchwytu `bottom`.
    const rawEnd = blockEndMinutes(projStart, projHours) + event.deltaMinutes;
    const newEnd = Math.max(projStart + MINUTE_STEP, Math.min(snapToStep(rawEnd), DAY_MINUTES));
    projHours = minutesToHours(newEnd - projStart);
    if (projHours > ctx.maxHours + 1e-9) {
      atCap = true;
      projHours = ctx.maxHours;
    }
  } else {
    projDayIndex = Math.max(0, Math.min(ctx.dayCount - 1, projDayIndex + event.delta));
  }

  const conflict = findBlockConflict(
    ctx.blocksOnDay(projDayIndex),
    projStart,
    hoursToMinutes(projHours),
    ctx.entryId,
  );
  const next: BlockKeyboardState = {
    projStart,
    projHours,
    projDayIndex,
    colliding: conflict !== null,
    atCap,
  };
  // Bez skutku → ta sama referencja. Wyjątek: samo oparcie się o limit budżetu
  // JEST skutkiem (blok dostaje ostrzegawczą obwódkę i zdanie o limicie), więc
  // wchodzi w tryb nawet wtedy, gdy geometria się nie ruszyła.
  if (state !== null) return sameProjection(state, next) ? state : next;
  return sameProjection(next, from) && !atCap ? state : next;
}

/**
 * Co wysłać przy zatwierdzeniu. `null` = nie ma czego wysyłać:
 * brak trybu, kolizja (inwariant 3 — klawiatura blokuje tak samo jak upuszczenie)
 * albo powrót dokładnie na zapisaną pozycję (no-opa do store'u nie wysyłamy).
 */
export function blockKeyboardCommit(
  state: BlockKeyboardState | null,
  ctx: BlockKeyboardContext,
): BlockKeyboardCommit | null {
  if (state === null) return null;
  if (state.colliding) return null;
  if (
    state.projStart === ctx.baseStart &&
    state.projHours === ctx.baseHours &&
    state.projDayIndex === ctx.baseDayIndex
  ) {
    return null;
  }
  return {
    entryId: ctx.entryId,
    dayIndex: state.projDayIndex,
    startMinutes: state.projStart,
    plannedHours: state.projHours,
  };
}

// ---------- Komunikaty dla regionu `aria-live` (po polsku) ----------
// Osobne budowniczki zamiast pól w stanie: stan zostaje minimalny i porównywalny
// przez `===`, a testy sprawdzają BRZMIENIE bez udawania DOM-u (jak w
// `kanbanMove.ts`). Geometria jedzie przez `blockLabel`, żeby kafelek, wiersz
// TaskModal i ogłoszenie mówiły o bloku jednym zdaniem.

function geometryPhrase(g: BlockGeometry): string {
  return blockLabel({ date: g.date, startMinutes: g.startMinutes, plannedHours: g.plannedHours });
}

function conflictPhrase(title: string, conflict: { startMinutes: number; plannedHours: number }): string {
  const what = title === '' ? 'inną pracą' : `„${title}”`;
  return `Koliduje z ${what} ${formatMinutes(conflict.startMinutes)}–${formatMinutes(
    blockEndMinutes(conflict.startMinutes, conflict.plannedHours),
  )}.`;
}

/** Wejście w tryb: mówi CO się edytuje i GDZIE blok stoi po pierwszym kroku. */
export function blockEditAnnouncement(taskTitle: string, target: BlockGeometry): string {
  return `Edycja bloku: ${taskTitle}. Cel: ${geometryPhrase(target)}.`;
}

/** Każdy kolejny bezkolizyjny cel. */
export function blockTargetAnnouncement(target: BlockGeometry): string {
  return `Cel: ${geometryPhrase(target)}.`;
}

/** Kolizja: pełnym zdaniem, nie samą czerwoną obwódką. */
export function blockCollisionAnnouncement(
  target: BlockGeometry,
  conflictTitle: string,
  conflict: { startMinutes: number; plannedHours: number },
): string {
  return `Cel: ${geometryPhrase(target)}. ${conflictPhrase(conflictTitle, conflict)}`;
}

/** Rozciąganie oparte o limit godzin zadania (to samo brzmienie co w dymku). */
export function blockCapAnnouncement(): string {
  return 'Limit czasu zadania — brak godzin w zasobniku.';
}

export function blockCommitAnnouncement(taskTitle: string, target: BlockGeometry): string {
  return `Zapisano: ${taskTitle} — ${geometryPhrase(target)}.`;
}

/** Próba zapisu na kolizji — zapis NIE poszedł, blok wraca na swoje miejsce. */
export function blockRejectedAnnouncement(
  conflictTitle: string,
  conflict: { startMinutes: number; plannedHours: number },
): string {
  return `Nie zapisano. ${conflictPhrase(conflictTitle, conflict)}`;
}

/** Zatwierdzenie bez zmian — nic nie poszło do store'u, i tak trzeba to powiedzieć. */
export function blockUnchangedAnnouncement(taskTitle: string): string {
  return `Bez zmian: ${taskTitle} zostaje na swoim miejscu.`;
}

export function blockRevertAnnouncement(taskTitle: string, base: BlockGeometry): string {
  return `Anulowano edycję. ${taskTitle} wraca na ${geometryPhrase(base)}.`;
}

export function blockToBinAnnouncement(taskTitle: string): string {
  return `Przeniesiono do zasobnika: ${taskTitle}.`;
}
