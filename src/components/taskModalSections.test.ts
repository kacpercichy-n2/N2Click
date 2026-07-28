// Testy czystego modelu kolejności/widoczności sekcji TaskModala. Bez Reacta i
// bez store'u — wejściem są gotowe bramki, wyjściem lista sekcji i zakładek.
import { describe, expect, it } from 'vitest';
import {
  initialTab,
  opensAtTop,
  resolveTabNavKey,
  visibleSections,
  visibleTabs,
  type SectionFlags,
  type TaskModalSectionId,
} from './taskModalSections';

/** Zapisane, opublikowane zadanie z poprawnym okresem, osobami i blokami. */
const EDIT: SectionFlags = {
  isEdit: true,
  isDraft: false,
  hasValidPeriod: true,
  hasAssignees: true,
  hasBlocks: true,
  commentCount: 0,
};

/** Nowe zadanie: jeszcze nie istnieje, więc brak bloków i komentarzy. */
const CREATE: SectionFlags = {
  isEdit: false,
  isDraft: false,
  hasValidPeriod: false,
  hasAssignees: false,
  hasBlocks: false,
  commentCount: 0,
};

const ids = (flags: SectionFlags): TaskModalSectionId[] =>
  visibleSections(flags).map((s) => s.id);

describe('visibleSections', () => {
  it('edycja pokazuje pełną kolejność: kontekst → okres → osoby → planowanie → rozmowa', () => {
    expect(ids(EDIT)).toEqual([
      'context',
      'details',
      'period',
      'people-hours',
      'summary',
      'checklist',
      'recurrence',
      'classification',
      'allocation',
      'done-blocks',
      'discussion',
    ]);
  });

  it('okres stoi NAD godzinami i siatką przydziału', () => {
    const order = ids(EDIT);
    expect(order.indexOf('period')).toBeLessThan(order.indexOf('people-hours'));
    expect(order.indexOf('period')).toBeLessThan(order.indexOf('allocation'));
  });

  it('tryb tworzenia bez poprawnego okresu ma dokładnie sekcje 1–5 + checklista', () => {
    expect(ids(CREATE)).toEqual([
      'context',
      'details',
      'period',
      'people-hours',
      'summary',
      'checklist',
      'classification',
    ]);
  });

  it('tryb tworzenia dostaje siatkę dopiero po ustawieniu poprawnego okresu', () => {
    expect(ids({ ...CREATE, hasValidPeriod: true })).toEqual([
      'context',
      'details',
      'period',
      'people-hours',
      'summary',
      'checklist',
      'classification',
      'allocation',
    ]);
  });

  it('cykliczność, dyskusja i wykonane bloki nie istnieją przed zapisem', () => {
    for (const id of ['recurrence', 'discussion', 'done-blocks'] as const) {
      expect(ids({ ...CREATE, hasValidPeriod: true })).not.toContain(id);
    }
  });

  it('wykonane bloki wymagają zapisanego zadania Z blokami', () => {
    expect(ids({ ...EDIT, hasBlocks: false })).not.toContain('done-blocks');
    expect(ids(EDIT)).toContain('done-blocks');
  });

  it('szkic chowa podsumowanie, siatkę i cykliczność', () => {
    const draft = ids({ ...EDIT, isDraft: true });
    expect(draft).not.toContain('summary');
    expect(draft).not.toContain('allocation');
    expect(draft).not.toContain('recurrence');
    // Reszta zostaje — szkic nadal ma osoby, checklistę i dyskusję.
    expect(draft).toEqual([
      'context',
      'details',
      'period',
      'people-hours',
      'checklist',
      'classification',
      'done-blocks',
      'discussion',
    ]);
  });

  it('zwijalne są WYŁĄCZNIE cykliczność, klasyfikacja i wykonane bloki', () => {
    const collapsible = visibleSections(EDIT)
      .filter((s) => s.collapsible)
      .map((s) => s.id);
    // IA-08 dołożyło „Wykonane bloki": ✓ stoi teraz na kafelku kalendarza,
    // więc lista nie musi być rozwinięta domyślnie.
    expect(collapsible).toEqual(['recurrence', 'classification', 'done-blocks']);
  });

  it('kontekst jest PIERWSZĄ sekcją w każdym trybie — pole startowe leży na górze', () => {
    // Kontrakt fokusa startowego: `data-autofocus` siedzi na `t-title` w sekcji
    // „context", a powłoka modala fokusuje je z `preventScroll`. Gdyby kontekst
    // przestał być pierwszy, fokus startowy wskazywałby pole POD zgięciem i
    // otwarcie znowu przewijałoby kartę w dół.
    for (const flags of [
      EDIT,
      { ...EDIT, isEdit: false, hasBlocks: false },
      { ...EDIT, isDraft: true },
      { ...EDIT, hasValidPeriod: false, isEdit: false, hasBlocks: false },
    ]) {
      expect(visibleSections(flags)[0].id).toBe('context');
    }
  });

  it('każda sekcja należy do zakładki zgodnej z układem paneli', () => {
    const byId = new Map(visibleSections(EDIT).map((s) => [s.id, s.tab] as const));
    expect(byId.get('context')).toBe('zadanie');
    expect(byId.get('allocation')).toBe('planowanie');
    expect(byId.get('done-blocks')).toBe('planowanie');
    expect(byId.get('discussion')).toBe('dyskusja');
  });
});

describe('visibleTabs', () => {
  it('edycja ma trzy zakładki, a „Dyskusja" niesie licznik komentarzy', () => {
    expect(visibleTabs({ ...EDIT, commentCount: 3 })).toEqual([
      { id: 'zadanie', label: 'Zadanie' },
      { id: 'planowanie', label: 'Planowanie' },
      { id: 'dyskusja', label: 'Dyskusja (3)' },
    ]);
  });

  it('zero komentarzy nadal pokazuje licznik', () => {
    expect(visibleTabs(EDIT).map((t) => t.label)).toContain('Dyskusja (0)');
  });

  it('tworzenie bez okresu ma JEDNĄ zakładkę (pasek zakładek się nie renderuje)', () => {
    expect(visibleTabs(CREATE)).toEqual([{ id: 'zadanie', label: 'Zadanie' }]);
  });

  it('poprawny okres w trybie tworzenia odsłania zakładkę „Planowanie"', () => {
    expect(visibleTabs({ ...CREATE, hasValidPeriod: true }).map((t) => t.id)).toEqual([
      'zadanie',
      'planowanie',
    ]);
  });

  it('szkic bez bloków nie ma zakładki „Planowanie"', () => {
    expect(
      visibleTabs({ ...EDIT, isDraft: true, hasBlocks: false }).map((t) => t.id),
    ).toEqual(['zadanie', 'dyskusja']);
  });
});

describe('initialTab', () => {
  it('wejście z konkretnego bloku otwiera „Planowanie"', () => {
    expect(initialTab({ hasFocusBlock: true, isEdit: true })).toBe('planowanie');
  });

  it('bez bloku (albo w trybie tworzenia) startuje „Zadanie"', () => {
    expect(initialTab({ hasFocusBlock: false, isEdit: true })).toBe('zadanie');
    expect(initialTab({ hasFocusBlock: true, isEdit: false })).toBe('zadanie');
    expect(initialTab({ hasFocusBlock: false, isEdit: false })).toBe('zadanie');
  });
});

describe('opensAtTop', () => {
  it('zwykłe otwarcie przewija na samą górę treści', () => {
    expect(opensAtTop({ hasFocusBlock: false })).toBe(true);
  });

  it('jawny deep-link do bloku zachowuje skok do celu', () => {
    expect(opensAtTop({ hasFocusBlock: true })).toBe(false);
  });

  it('deep-link, który wybiera „Planowanie", jest DOKŁADNIE tym samym wejściem', () => {
    // Jedna bramka rządzi obiema decyzjami: zakładką startową i pozycją
    // przewinięcia. Rozjazd tych dwóch znaczyłby „otwórz Planowanie, ale
    // przewiń na górę Zadania" — czyli skok do bloku bez skoku do bloku.
    for (const hasFocusBlock of [true, false]) {
      const startsOnPlanning = initialTab({ hasFocusBlock, isEdit: true }) === 'planowanie';
      expect(opensAtTop({ hasFocusBlock })).toBe(!startsOnPlanning);
    }
  });
});

describe('resolveTabNavKey', () => {
  it('strzałki zawijają się na krańcach paska', () => {
    expect(resolveTabNavKey('ArrowRight', 0, 3)).toBe(1);
    expect(resolveTabNavKey('ArrowRight', 2, 3)).toBe(0);
    expect(resolveTabNavKey('ArrowLeft', 2, 3)).toBe(1);
    expect(resolveTabNavKey('ArrowLeft', 0, 3)).toBe(2);
  });

  it('Home/End skaczą na brzegi', () => {
    expect(resolveTabNavKey('Home', 2, 3)).toBe(0);
    expect(resolveTabNavKey('End', 0, 3)).toBe(2);
  });

  it('fokus spoza paska wchodzi na pierwszą/ostatnią pozycję', () => {
    expect(resolveTabNavKey('ArrowRight', -1, 3)).toBe(0);
    expect(resolveTabNavKey('ArrowLeft', -1, 3)).toBe(2);
    expect(resolveTabNavKey('ArrowRight', 9, 3)).toBe(0);
  });

  it('klawisz nienawigacyjny i pusty pasek zwracają null', () => {
    expect(resolveTabNavKey('Enter', 0, 3)).toBeNull();
    expect(resolveTabNavKey('ArrowDown', 0, 3)).toBeNull();
    expect(resolveTabNavKey('a', 0, 3)).toBeNull();
    expect(resolveTabNavKey('ArrowRight', 0, 0)).toBeNull();
    expect(resolveTabNavKey('Home', 0, -1)).toBeNull();
  });
});
