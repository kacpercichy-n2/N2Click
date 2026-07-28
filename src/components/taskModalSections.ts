// Kolejność i widoczność sekcji TaskModala (PKG-20260728-taskmodal-structure).
//
// Czysta funkcja: wejściem są bramki, które TaskEditor i tak liczy (istnieje,
// szkic, poprawny okres, są bloki, ile komentarzy), wyjściem GOTOWA lista sekcji
// w kolejności renderowania oraz lista zakładek. Dzięki temu kolejność
// „co → kiedy → kto → ile → jak rozłożone → jak sprawdzę → rozmowa" mieszka w
// JEDNYM miejscu, a nie w kilkunastu warunkach rozsianych po JSX-ie.
//
// Kolejność listy = kolejność w DOM. Ta sama tablica bramkuje też zakładki:
// zakładka istnieje wyłącznie wtedy, gdy ma co najmniej jedną widoczną sekcję.

export type TaskModalTabId = 'zadanie' | 'planowanie' | 'dyskusja';

export type TaskModalSectionId =
  /** Przyklejona głowa: tytuł, projekt, status. */
  | 'context'
  /** Szczegóły: opis, priorytet. */
  | 'details'
  /** Okres: `t-start`, `t-end` — NAD godzinami (najpierw „kiedy"). */
  | 'period'
  /** Przypisane osoby + godziny sprzedane + panel dostępności. */
  | 'people-hours'
  /** Scalony pasek podsumowania planowania (zastąpił sekcję „Zasobnik"). */
  | 'summary'
  | 'checklist'
  /** Zwinięta za przełącznikiem „Powtarzaj to zadanie". */
  | 'recurrence'
  /** Zwinięta: kategoria, dział. */
  | 'classification'
  /** Dzienny przydział godzin (AllocationGrid). */
  | 'allocation'
  /** Wykonane bloki (per-block done). */
  | 'done-blocks'
  /** CommentsPanel — POZA formularzem zadania. */
  | 'discussion';

export interface TaskModalSection {
  id: TaskModalSectionId;
  tab: TaskModalTabId;
  /** `true` tylko dla „Cykliczność" i „Klasyfikacja". */
  collapsible: boolean;
}

/** Bramki widoczności — dokładnie te wartości, które TaskEditor już ma. */
export interface SectionFlags {
  /** Zadanie istnieje w stanie (`Boolean(existing)`). */
  isEdit: boolean;
  /** Szkic (nie planuje godzin do czasu publikacji). */
  isDraft: boolean;
  /** `periodError(...) === null`. */
  hasValidPeriod: boolean;
  /** Jest co najmniej jedna przypisana osoba. */
  hasAssignees: boolean;
  /** Zadanie ma już bloki w kalendarzu/zasobniku. */
  hasBlocks: boolean;
  /** Liczba komentarzy — wchodzi do etykiety zakładki „Dyskusja". */
  commentCount: number;
}

export interface TaskModalTab {
  id: TaskModalTabId;
  /** Etykieta W KOMPLECIE (dyskusja niesie licznik). */
  label: string;
}

/** Pełna kolejność sekcji. Filtrowanie NIGDY jej nie przestawia. */
const ALL_SECTIONS: readonly TaskModalSection[] = [
  { id: 'context', tab: 'zadanie', collapsible: false },
  { id: 'details', tab: 'zadanie', collapsible: false },
  { id: 'period', tab: 'zadanie', collapsible: false },
  { id: 'people-hours', tab: 'zadanie', collapsible: false },
  { id: 'summary', tab: 'zadanie', collapsible: false },
  { id: 'checklist', tab: 'zadanie', collapsible: false },
  { id: 'recurrence', tab: 'zadanie', collapsible: true },
  { id: 'classification', tab: 'zadanie', collapsible: true },
  { id: 'allocation', tab: 'planowanie', collapsible: false },
  { id: 'done-blocks', tab: 'planowanie', collapsible: false },
  { id: 'discussion', tab: 'dyskusja', collapsible: false },
];

/** Kolejność zakładek w pasku (ta sama, co kolejność sekcji). */
const TAB_ORDER: readonly TaskModalTabId[] = ['zadanie', 'planowanie', 'dyskusja'];

const TAB_LABELS: Record<TaskModalTabId, string> = {
  zadanie: 'Zadanie',
  planowanie: 'Planowanie',
  dyskusja: 'Dyskusja',
};

/** Bramka pojedynczej sekcji. Jedyne miejsce z warunkami widoczności. */
function isSectionVisible(id: TaskModalSectionId, flags: SectionFlags): boolean {
  switch (id) {
    case 'context':
    case 'details':
    case 'period':
    case 'people-hours':
    case 'checklist':
    case 'classification':
      return true;
    // Szkic nie planuje godzin, więc nie ma czego podsumowywać.
    case 'summary':
      return !flags.isDraft;
    // Cykliczność wymaga ZAPISANEGO, opublikowanego zadania (dispatch po id).
    // Tryb tworzenia i szkic nie renderują jej wcale — martwa podpowiedź
    // „Zapisz i opublikuj zadanie…" znika razem z sekcją.
    case 'recurrence':
      return flags.isEdit && !flags.isDraft;
    // Tworzenie MOŻE planować godziny, ale dopiero gdy okres jest poprawny —
    // siatka nigdy nie wisi nad nieistniejącym okresem.
    case 'allocation':
      return !flags.isDraft && (flags.isEdit || flags.hasValidPeriod);
    case 'done-blocks':
      return flags.isEdit && flags.hasBlocks;
    case 'discussion':
      return flags.isEdit;
  }
}

/** Sekcje do wyrenderowania, w GLOBALNEJ kolejności, przefiltrowane. */
export function visibleSections(flags: SectionFlags): TaskModalSection[] {
  return ALL_SECTIONS.filter((section) => isSectionVisible(section.id, flags));
}

/**
 * Zakładki, które mają choć jedną widoczną sekcję. „Zadanie" jest zawsze
 * pierwsza (jej sekcje są bezwarunkowe). Etykieta „Dyskusja" niesie licznik
 * komentarzy — warstwa DOM-owa nie dokleja nic od siebie.
 */
export function visibleTabs(flags: SectionFlags): TaskModalTab[] {
  const sections = visibleSections(flags);
  return TAB_ORDER.filter((tab) => sections.some((s) => s.tab === tab)).map((tab) => ({
    id: tab,
    label: tab === 'dyskusja' ? `${TAB_LABELS[tab]} (${flags.commentCount})` : TAB_LABELS[tab],
  }));
}

/**
 * Zakładka otwierana na starcie. Wejście z konkretnego bloku
 * (`?task=<id>&block=<id>`) musi od razu pokazać panel „Planowanie", bo tam
 * mieszka podświetlany wiersz — ukryty panel nie da się przewinąć do widoku.
 */
export function initialTab(args: { hasFocusBlock: boolean; isEdit: boolean }): TaskModalTabId {
  return args.hasFocusBlock && args.isEdit ? 'planowanie' : 'zadanie';
}

/**
 * Ruch fokusa po POZIOMYM pasku zakładek (odpowiednik `resolveMenuNavKey` dla
 * osi X). Strzałki zawijają się na krańcach, Home/End skaczą na brzegi,
 * `currentIndex` poza zakresem znaczy „fokus jeszcze nie wszedł w pasek".
 * `null` = klawisz nie jest nawigacyjny, warstwa DOM-owa go nie rusza.
 */
export function resolveTabNavKey(key: string, currentIndex: number, count: number): number | null {
  if (count <= 0) return null;
  const inList = currentIndex >= 0 && currentIndex < count;
  switch (key) {
    case 'ArrowRight':
      return inList ? (currentIndex + 1) % count : 0;
    case 'ArrowLeft':
      return inList ? (currentIndex - 1 + count) % count : count - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
