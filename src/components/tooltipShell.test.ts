import { describe, expect, it } from 'vitest';
import {
  TOOLTIP_OPEN_DELAY_MS,
  TOOLTIP_WARM_GRACE_MS,
  buildTooltipText,
  createTooltipGroup,
  isTooltipGroupWarm,
  mergeDescribedBy,
  noteHide,
  noteShow,
  resolveShowDelay,
  resolveTooltipTrigger,
  tooltipDescribes,
} from './tooltipShell';

describe('opóźnienie grupowe', () => {
  it('pierwszy dymek czeka pełną zwłokę', () => {
    const group = createTooltipGroup();
    expect(isTooltipGroupWarm(group, 1000)).toBe(false);
    expect(resolveShowDelay(group, 1000)).toBe(TOOLTIP_OPEN_DELAY_MS);
  });

  it('gdy dymek jest pokazany, kolejny wchodzi natychmiast', () => {
    const group = createTooltipGroup();
    noteShow(group, 1000);
    expect(isTooltipGroupWarm(group, 1000)).toBe(true);
    expect(resolveShowDelay(group, 1000)).toBe(0);
  });

  it('okno łaski po schowaniu trzyma grupę ciepłą', () => {
    const group = createTooltipGroup();
    noteShow(group, 1000);
    noteHide(group, 2000);
    expect(resolveShowDelay(group, 2000)).toBe(0);
    expect(resolveShowDelay(group, 2000 + TOOLTIP_WARM_GRACE_MS - 1)).toBe(0);
  });

  it('po upływie okna łaski grupa stygnie i znów obowiązuje zwłoka', () => {
    const group = createTooltipGroup();
    noteShow(group, 1000);
    noteHide(group, 2000);
    expect(isTooltipGroupWarm(group, 2000 + TOOLTIP_WARM_GRACE_MS)).toBe(false);
    expect(resolveShowDelay(group, 2000 + TOOLTIP_WARM_GRACE_MS)).toBe(TOOLTIP_OPEN_DELAY_MS);
    // …i cykl da się powtórzyć od zera.
    noteShow(group, 5000);
    expect(resolveShowDelay(group, 5000)).toBe(0);
  });

  it('schowanie nie schodzi poniżej zera przy niesparowanych wywołaniach', () => {
    const group = createTooltipGroup();
    noteHide(group, 1000);
    expect(group.shown).toBe(0);
  });
});

describe('rozstrzyganie wyzwalaczy', () => {
  const cold = createTooltipGroup();

  it('mysz planuje pokazanie z rozstrzygniętą zwłoką', () => {
    expect(resolveTooltipTrigger({ type: 'pointerenter', pointerType: 'mouse' }, cold, 0)).toEqual({
      kind: 'show',
      delayMs: TOOLTIP_OPEN_DELAY_MS,
    });
    const warm = createTooltipGroup();
    noteShow(warm, 0);
    expect(resolveTooltipTrigger({ type: 'pointerenter', pointerType: 'mouse' }, warm, 0)).toEqual({
      kind: 'show',
      delayMs: 0,
    });
  });

  it('dotyk i rysik nigdy nie pokazują dymka', () => {
    for (const pointerType of ['touch', 'pen', '']) {
      expect(resolveTooltipTrigger({ type: 'pointerenter', pointerType }, cold, 0)).toEqual({
        kind: 'none',
      });
    }
  });

  it('fokus klawiaturowy pokazuje natychmiast, zwykły fokus wcale', () => {
    expect(resolveTooltipTrigger({ type: 'focus', focusVisible: true }, cold, 0)).toEqual({
      kind: 'show',
      delayMs: 0,
    });
    expect(resolveTooltipTrigger({ type: 'focus', focusVisible: false }, cold, 0)).toEqual({
      kind: 'none',
    });
  });

  it('opuszczenie, rozmycie, wciśnięcie i Escape chowają', () => {
    expect(resolveTooltipTrigger({ type: 'pointerleave' }, cold, 0)).toEqual({ kind: 'hide' });
    expect(resolveTooltipTrigger({ type: 'blur' }, cold, 0)).toEqual({ kind: 'hide' });
    expect(resolveTooltipTrigger({ type: 'pointerdown' }, cold, 0)).toEqual({ kind: 'hide' });
    expect(resolveTooltipTrigger({ type: 'keydown', key: 'Escape' }, cold, 0)).toEqual({
      kind: 'hide',
    });
  });

  it('inne klawisze niczego nie zmieniają', () => {
    expect(resolveTooltipTrigger({ type: 'keydown', key: 'Enter' }, cold, 0)).toEqual({
      kind: 'none',
    });
  });
});

describe('kontrakt dostępności', () => {
  it('tekst równy nazwie jest czysto wizualny', () => {
    expect(tooltipDescribes('Usuń', 'Usuń')).toBe(false);
    expect(tooltipDescribes('  Usuń  ', 'usuń')).toBe(false);
    expect(tooltipDescribes('ZWIŃ MENU', 'Zwiń menu')).toBe(false);
  });

  it('tekst zawarty w nazwie też nie dubluje opisu', () => {
    expect(tooltipDescribes('Usuń zadanie', 'Usuń')).toBe(false);
    expect(tooltipDescribes('Usuń  zadanie', 'usuń zadanie')).toBe(false);
  });

  it('polskie znaki rozróżniają teksty', () => {
    expect(tooltipDescribes('Zapisz', 'Zapisz zmiany')).toBe(true);
    expect(tooltipDescribes('Ustawienia', 'Skrót: przejdź do ustawień')).toBe(true);
  });

  it('pusty tekst nie opisuje, brak nazwy opisuje', () => {
    expect(tooltipDescribes('Usuń', '   ')).toBe(false);
    expect(tooltipDescribes('', 'Otwórz profil: Ada')).toBe(true);
  });
});

describe('tekst opisu', () => {
  it('dopisuje skrót słownie', () => {
    expect(buildTooltipText('Zapisz', 'S')).toBe('Zapisz (skrót: S)');
    expect(buildTooltipText('Zapisz')).toBe('Zapisz');
    expect(buildTooltipText('Zapisz', '  ')).toBe('Zapisz');
    expect(buildTooltipText('Zapisz', null)).toBe('Zapisz');
    expect(buildTooltipText('', 'Esc')).toBe('skrót: Esc');
  });

  it('scala aria-describedby bez duplikatów', () => {
    expect(mergeDescribedBy(undefined, 'tip-1')).toBe('tip-1');
    expect(mergeDescribedBy('pole-help pole-error', 'tip-1')).toBe('pole-help pole-error tip-1');
    expect(mergeDescribedBy('tip-1', 'tip-1')).toBe('tip-1');
  });
});
