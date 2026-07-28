// Testy czystej powłoki popovera. Bez DOM-u i bez Reacta — wejściem są gołe
// prostokąty, nazwy zdarzeń i etykiety, więc całość działa w środowisku `node`.
import { describe, expect, it } from 'vitest';
import {
  createDismissState,
  createOverlayStack,
  isAnchorOutOfView,
  matchTypeahead,
  resolveDismissEvent,
  resolveMenuNavKey,
  resolveOverlayPosition,
  type OverlayDismissEvent,
} from './overlayShell';

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 240, height: 200 };

describe('resolveOverlayPosition — flip', () => {
  it('punkt kliknięcia przy dolnej krawędzi odbija menu NAD kursor', () => {
    // 92 px pod kursorem, 692 px nad nim — menu (200 px) mieści się tylko nad.
    const out = resolveOverlayPosition({ left: 100, top: 700, width: 0, height: 0 }, MENU, VIEWPORT);
    expect(out.placement).toBe('top-start');
    expect(out.top).toBe(500);
    expect(out.left).toBe(100);
  });

  it('bez odbicia, gdy preferowana strona ma dość miejsca', () => {
    const out = resolveOverlayPosition({ left: 100, top: 100, width: 0, height: 0 }, MENU, VIEWPORT);
    expect(out.placement).toBe('bottom-start');
    expect(out.top).toBe(100);
  });

  it('bez odbicia, gdy druga strona jest jeszcze ciaśniejsza (zostaje sam shift)', () => {
    // Menu 900 px nie mieści się nigdzie, ale pod kursorem jest 692 px, nad 92 px.
    const tall = { width: 240, height: 900 };
    const out = resolveOverlayPosition({ left: 100, top: 100, width: 0, height: 0 }, tall, VIEWPORT);
    expect(out.placement).toBe('bottom-start');
    expect(out.top).toBe(8); // wciśnięte do marginesu, resztę bierze max-height
  });

  it('odstęp i wysokość kotwicy liczą się w obie strony (przycisk „Zaplanuj część”)', () => {
    const button = { left: 40, top: 700, width: 120, height: 24 };
    const out = resolveOverlayPosition(button, MENU, VIEWPORT, { offset: 4 });
    // Pod przyciskiem zostaje 800-8-728=64 px, nad nim 700-4-8=688 px → flip.
    expect(out.placement).toBe('top-start');
    expect(out.top).toBe(496); // 700 - 4 - 200
    const roomy = resolveOverlayPosition({ ...button, top: 100 }, MENU, VIEWPORT, { offset: 4 });
    expect(roomy.placement).toBe('bottom-start');
    expect(roomy.top).toBe(128); // 100 + 24 + 4
    expect(roomy.left).toBe(40);
  });

  it('placement right-start odbija się na lewą stronę kotwicy', () => {
    const anchor = { left: 900, top: 100, width: 40, height: 20 };
    const out = resolveOverlayPosition(anchor, MENU, VIEWPORT, { placement: 'right-start' });
    expect(out.placement).toBe('left-start');
    expect(out.left).toBe(660); // 900 - 0 - 240
    expect(out.top).toBe(100);
    const roomy = resolveOverlayPosition({ ...anchor, left: 100 }, MENU, VIEWPORT, {
      placement: 'right-start',
      offset: 6,
    });
    expect(roomy.placement).toBe('right-start');
    expect(roomy.left).toBe(146); // 100 + 40 + 6
  });
});

describe('resolveOverlayPosition — shift', () => {
  it('wciska menu poziomo w okno pomniejszone o margines', () => {
    const out = resolveOverlayPosition({ left: 980, top: 100, width: 0, height: 0 }, MENU, VIEWPORT);
    expect(out.left).toBe(752); // 1000 - 8 - 240
    expect(out.placement).toBe('bottom-start');
  });

  it('wciska menu pionowo, gdy odbicie nic nie daje', () => {
    const out = resolveOverlayPosition(
      { left: 10, top: 780, width: 0, height: 0 },
      { width: 240, height: 700 },
      VIEWPORT,
    );
    // Nad kursorem 772 px > 12 px pod nim → flip, a potem shift do marginesu.
    expect(out.placement).toBe('top-start');
    expect(out.top).toBe(80); // 780 - 700
    expect(out.left).toBe(10);
  });

  it('lewa/górna krawędź też jest respektowana', () => {
    const out = resolveOverlayPosition({ left: -50, top: -30, width: 0, height: 0 }, MENU, VIEWPORT);
    expect(out.left).toBe(8);
    expect(out.top).toBe(8);
  });

  it('własny margines zmienia obie krawędzie', () => {
    const out = resolveOverlayPosition({ left: 980, top: 100, width: 0, height: 0 }, MENU, VIEWPORT, {
      margin: 20,
    });
    expect(out.left).toBe(740); // 1000 - 20 - 240
  });

  it('menu szersze niż okno przykleja się do marginesu początkowego', () => {
    const huge = { width: 1200, height: 100 };
    const out = resolveOverlayPosition({ left: 500, top: 100, width: 0, height: 0 }, huge, VIEWPORT);
    expect(out.left).toBe(8);
  });
});

describe('resolveOverlayPosition — availableHeight', () => {
  it('liczy miejsce od rozwiązanego topu do dolnej krawędzi minus margines', () => {
    const out = resolveOverlayPosition({ left: 10, top: 100, width: 0, height: 0 }, MENU, VIEWPORT);
    expect(out.availableHeight).toBe(692); // 800 - 8 - 100
  });

  it('po odbiciu rośnie razem z przesunięciem w górę', () => {
    const out = resolveOverlayPosition({ left: 10, top: 700, width: 0, height: 0 }, MENU, VIEWPORT);
    expect(out.top).toBe(500);
    expect(out.availableHeight).toBe(292); // 800 - 8 - 500
  });

  it('przy menu wyższym od okna schodzi do wysokości okna bez marginesów', () => {
    const tall = { width: 240, height: 2000 };
    const out = resolveOverlayPosition({ left: 10, top: 400, width: 0, height: 0 }, tall, VIEWPORT);
    expect(out.top).toBe(8);
    expect(out.availableHeight).toBe(784); // 800 - 8 - 8
  });

  it('nigdy nie schodzi poniżej zera', () => {
    const out = resolveOverlayPosition(
      { left: 10, top: 100, width: 0, height: 0 },
      { width: 10, height: 10 },
      { width: 100, height: 10 },
    );
    expect(out.availableHeight).toBeGreaterThanOrEqual(0);
  });
});

describe('isAnchorOutOfView', () => {
  const BTN = { left: 100, top: 100, width: 120, height: 32 };

  it('kotwica w środku okna jest widoczna', () => {
    expect(isAnchorOutOfView(BTN, VIEWPORT)).toBe(false);
  });

  it('kotwica wyscrollowana ponad górną krawędź wypada z widoku', () => {
    // Dolna krawędź na 0 px — przycisk zniknął pod nagłówkiem.
    expect(isAnchorOutOfView({ ...BTN, top: -32 }, VIEWPORT)).toBe(true);
    // Jeden piksel jeszcze widać, więc popover zostaje otwarty.
    expect(isAnchorOutOfView({ ...BTN, top: -31 }, VIEWPORT)).toBe(false);
  });

  it('kotwica pod dolną krawędzią wypada z widoku', () => {
    expect(isAnchorOutOfView({ ...BTN, top: 800 }, VIEWPORT)).toBe(true);
    expect(isAnchorOutOfView({ ...BTN, top: 799 }, VIEWPORT)).toBe(false);
  });

  it('liczy też oś poziomą (przewijana siatka)', () => {
    expect(isAnchorOutOfView({ ...BTN, left: -120 }, VIEWPORT)).toBe(true);
    expect(isAnchorOutOfView({ ...BTN, left: 1000 }, VIEWPORT)).toBe(true);
    expect(isAnchorOutOfView({ ...BTN, left: -119 }, VIEWPORT)).toBe(false);
    expect(isAnchorOutOfView({ ...BTN, left: 999 }, VIEWPORT)).toBe(false);
  });

  it('margines zawęża widoczny obszar', () => {
    const nearlyGone = { ...BTN, top: -28 }; // widoczne 4 px
    expect(isAnchorOutOfView(nearlyGone, VIEWPORT)).toBe(false);
    expect(isAnchorOutOfView(nearlyGone, VIEWPORT, 8)).toBe(true);
  });
});

describe('createOverlayStack', () => {
  it('Escape obsługuje tylko ostatnio dołożona warstwa', () => {
    const stack = createOverlayStack();
    stack.push('modal');
    stack.push('popover');
    expect(stack.isTop('popover')).toBe(true);
    expect(stack.isTop('modal')).toBe(false);
    expect(stack.count()).toBe(2);
    stack.remove('popover');
    expect(stack.isTop('modal')).toBe(true);
    expect(stack.count()).toBe(1);
  });

  it('ponowny push przenosi istniejące id na wierzch (bez duplikatu)', () => {
    const stack = createOverlayStack();
    stack.push('a');
    stack.push('b');
    stack.push('a');
    expect(stack.isTop('a')).toBe(true);
    expect(stack.count()).toBe(2);
    stack.remove('a');
    expect(stack.isTop('b')).toBe(true);
    expect(stack.count()).toBe(1);
  });

  it('usunięcie środkowego id zachowuje kolejność pozostałych', () => {
    const stack = createOverlayStack();
    stack.push('a');
    stack.push('b');
    stack.push('c');
    stack.remove('b');
    expect(stack.isTop('c')).toBe(true);
    stack.remove('c');
    expect(stack.isTop('a')).toBe(true);
    expect(stack.count()).toBe(1);
  });

  it('pusty stos nie ma wierzchu, a usuwanie nieznanego id jest bezpieczne', () => {
    const stack = createOverlayStack();
    expect(stack.isTop('a')).toBe(false);
    stack.remove('a');
    expect(stack.count()).toBe(0);
  });

  it('każda instancja liczy osobno', () => {
    const a = createOverlayStack();
    const b = createOverlayStack();
    a.push('x');
    expect(b.count()).toBe(0);
    expect(b.isTop('x')).toBe(false);
  });
});

/** Podaje sekwencję zdarzeń i zwraca kroki, w których maszyna zamyka popover. */
function runDismiss(events: OverlayDismissEvent[]): boolean[] {
  let state = createDismissState();
  return events.map((event) => {
    const out = resolveDismissEvent(state, event);
    state = out.next;
    return out.close;
  });
}

describe('resolveDismissEvent', () => {
  it('para pointerdown + click na zewnątrz zamyka', () => {
    expect(runDismiss(['pointerdown-outside', 'click-outside'])).toEqual([false, true]);
  });

  it('sam click na zewnątrz (pasek przewijania, ta sama klatka) NIE zamyka', () => {
    expect(runDismiss(['click-outside'])).toEqual([false]);
  });

  it('zaznaczanie tekstu z wnętrza wyprowadzone na zewnątrz NIE zamyka', () => {
    expect(runDismiss(['pointerdown-inside', 'click-outside'])).toEqual([false, false]);
  });

  it('para rozbrojona kliknięciem w środku nie zamyka przy kolejnym clicku', () => {
    expect(
      runDismiss(['pointerdown-outside', 'click-inside', 'click-outside']),
    ).toEqual([false, false, false]);
  });

  it('zdarzenia na przycisku otwierającym nigdy nie zamykają (własny toggle)', () => {
    expect(runDismiss(['pointerdown-trigger', 'click-trigger'])).toEqual([false, false]);
    expect(runDismiss(['pointerdown-outside', 'click-trigger'])).toEqual([false, false]);
  });

  it('contextmenu na zewnątrz zamyka natychmiast, bez czekania na click', () => {
    expect(runDismiss(['contextmenu-outside'])).toEqual([true]);
    // Prawy klik: pointerdown zbroi parę, contextmenu zamyka i ją rozbraja,
    // więc późniejszy auxclick nie zamyka już nowo otwartego menu.
    expect(
      runDismiss(['pointerdown-outside', 'contextmenu-outside', 'click-outside']),
    ).toEqual([false, true, false]);
  });

  it('kolejna para po rozbrojeniu znowu zamyka', () => {
    expect(
      runDismiss(['pointerdown-inside', 'click-inside', 'pointerdown-outside', 'click-outside']),
    ).toEqual([false, false, false, true]);
  });

  it('nie mutuje przekazanego stanu', () => {
    const state = createDismissState();
    const out = resolveDismissEvent(state, 'pointerdown-outside');
    expect(state.armed).toBe(false);
    expect(out.next.armed).toBe(true);
  });
});

describe('resolveMenuNavKey', () => {
  it('strzałki zawijają się w obie strony', () => {
    expect(resolveMenuNavKey('ArrowDown', 0, 3)).toBe(1);
    expect(resolveMenuNavKey('ArrowDown', 2, 3)).toBe(0);
    expect(resolveMenuNavKey('ArrowUp', 0, 3)).toBe(2);
    expect(resolveMenuNavKey('ArrowUp', 1, 3)).toBe(0);
  });

  it('fokus poza listą (-1) wchodzi na pierwszą albo ostatnią pozycję', () => {
    expect(resolveMenuNavKey('ArrowDown', -1, 3)).toBe(0);
    expect(resolveMenuNavKey('ArrowUp', -1, 3)).toBe(2);
    // Indeks spoza zakresu traktujemy jak fokus poza listą.
    expect(resolveMenuNavKey('ArrowDown', 9, 3)).toBe(0);
  });

  it('Home i End skaczą na krańce', () => {
    expect(resolveMenuNavKey('Home', 2, 3)).toBe(0);
    expect(resolveMenuNavKey('End', 0, 3)).toBe(2);
    expect(resolveMenuNavKey('End', -1, 3)).toBe(2);
  });

  it('inne klawisze i pusta lista nie ruszają fokusa', () => {
    expect(resolveMenuNavKey('Escape', 0, 3)).toBeNull();
    expect(resolveMenuNavKey('Tab', 0, 3)).toBeNull();
    expect(resolveMenuNavKey('a', 0, 3)).toBeNull();
    expect(resolveMenuNavKey('ArrowDown', 0, 0)).toBeNull();
  });

  it('jedna pozycja zawija się na siebie samą', () => {
    expect(resolveMenuNavKey('ArrowDown', 0, 1)).toBe(0);
    expect(resolveMenuNavKey('ArrowUp', 0, 1)).toBe(0);
  });
});

describe('matchTypeahead', () => {
  const labels = [
    '↑ Dodaj przed',
    '↓ Dodaj po',
    'Podziel na pół',
    'Podziel na ćwiartki',
    'Zaplanuj część…',
  ];

  it('dopasowuje prefiks bez względu na wielkość liter', () => {
    expect(matchTypeahead(labels, 'p', 0)).toBe(2);
    expect(matchTypeahead(labels, 'POD', 0)).toBe(2);
    expect(matchTypeahead(labels, 'zap', 0)).toBe(4);
  });

  it('skanuje od podanego indeksu i zawija się na początek listy', () => {
    expect(matchTypeahead(labels, 'p', 3)).toBe(3);
    expect(matchTypeahead(labels, 'p', 4)).toBe(2); // zawinięcie
    expect(matchTypeahead(labels, 'z', 0)).toBe(4);
    expect(matchTypeahead(labels, 'z', 5)).toBe(4); // indeks poza zakresem → od zera
  });

  it('polskie znaki diakrytyczne dopasowują się po zmniejszeniu liter', () => {
    expect(matchTypeahead(['Ćwiartki', 'Inne'], 'ć', 0)).toBe(0);
    expect(matchTypeahead(['Łatwe', 'Inne'], 'ł', 0)).toBe(0);
    expect(matchTypeahead(['Środa', 'Inne'], 'ŚR', 0)).toBe(0);
  });

  it('brak trafienia, pusty bufor i pusta lista dają null', () => {
    expect(matchTypeahead(labels, 'x', 0)).toBeNull();
    expect(matchTypeahead(labels, '', 0)).toBeNull();
    expect(matchTypeahead(labels, '   ', 0)).toBeNull();
    expect(matchTypeahead([], 'a', 0)).toBeNull();
  });

  it('etykiety są przycinane, więc wiodące spacje nie psują dopasowania', () => {
    expect(matchTypeahead(['  Usuń blok'], 'usu', 0)).toBe(0);
  });
});
