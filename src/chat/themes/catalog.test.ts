// Katalog motywów: identyfikatory w formacie CHECK-a bazy, unikalne, domyślny
// obecny; kontrast WCAG AA (≥ 4,5:1) tekstu na KAŻDYM stopie gradientu mojego
// dymka i na cudzym dymku; assety wzorów/obrazów istnieją w `public/`;
// emoji motywu jest na liście pickera (allowlista reakcji).
import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES } from '../ui/chatEmoji';
import {
  CHAT_THEMES,
  CHAT_THEME_ID_PATTERN,
  DEFAULT_THEME_ID,
  isKnownThemeId,
  themeById,
} from './catalog';
import { WCAG_AA_TEXT, contrastRatio, relativeLuminance, themeCssVars } from './themeVars';

const assets = import.meta.glob('../../../public/chat-themes/**/*', { eager: true, query: '?url' });
const assetPaths = new Set(
  Object.keys(assets).map((path) => path.replace(/^.*\/public\/chat-themes\//, '')),
);
const pickerEmoji = new Set(EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((e) => e.char)));

describe('katalog motywów czatu', () => {
  it('id są unikalne, w formacie bazy, a domyślny istnieje', () => {
    const ids = CHAT_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(CHAT_THEME_ID_PATTERN);
    expect(ids).toContain(DEFAULT_THEME_ID);
    expect(themeById('nie-ma-takiego').id).toBe(DEFAULT_THEME_ID);
    expect(themeById(null).id).toBe(DEFAULT_THEME_ID);
    expect(isKnownThemeId('lawenda')).toBe(true);
    expect(isKnownThemeId('')).toBe(false);
  });

  it('każdy motyw ma polską nazwę i emoji z listy pickera', () => {
    for (const theme of CHAT_THEMES) {
      expect(theme.name.trim().length, theme.id).toBeGreaterThan(0);
      expect(pickerEmoji.has(theme.quickReaction), `${theme.id}: ${theme.quickReaction}`).toBe(true);
    }
  });

  it('tekst na dymkach ma kontrast AA (≥ 4,5:1) na każdym stopie gradientu', () => {
    for (const theme of CHAT_THEMES) {
      for (const stop of theme.bubbleMine.gradient) {
        const ratio = contrastRatio(stop, theme.bubbleMine.text);
        expect(ratio, `${theme.id}: mój dymek ${stop}`).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      }
      const theirs = contrastRatio(theme.bubbleTheirs.bg, theme.bubbleTheirs.text);
      expect(theirs, `${theme.id}: cudzy dymek`).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      const accent = contrastRatio(theme.accent, theme.accentText);
      expect(accent, `${theme.id}: przycisk wyślij`).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    }
  });

  it('assety wzorów i obrazów istnieją w public/chat-themes', () => {
    for (const theme of CHAT_THEMES) {
      const bg = theme.background;
      if (bg.kind === 'pattern' || bg.kind === 'image') {
        expect(assetPaths.has(bg.asset), `${theme.id}: brak pliku ${bg.asset}`).toBe(true);
      }
      if (bg.kind === 'pattern') {
        expect(bg.opacity).toBeGreaterThan(0);
        expect(bg.opacity).toBeLessThanOrEqual(0.5);
        expect(bg.tile).toBeGreaterThan(0);
      }
      if (bg.kind === 'image') {
        expect(bg.dim).toBeGreaterThanOrEqual(0.2);
        expect(bg.dim).toBeLessThanOrEqual(0.8);
      }
    }
  });
});

describe('themeCssVars', () => {
  it('zawsze ustawia komplet zmiennych, a wzór/obraz tylko dla swojego rodzaju', () => {
    const solid = themeCssVars(themeById('lawenda'));
    expect(solid['--chat-bubble-mine-from']).toBe('#7000ff');
    expect(solid['--chat-pattern-mask']).toBe('none');
    expect(solid['--chat-bg-image']).toBe('none');
    expect(solid['--chat-bg-dim']).toBe('0');

    const pattern = themeCssVars(themeById('neon'));
    expect(pattern['--chat-pattern-mask']).toBe('url(/chat-themes/patterns/dots.svg)');
    expect(pattern['--chat-pattern-size']).toBe('24px');
    expect(Number(pattern['--chat-pattern-opacity'])).toBeGreaterThan(0);

    const gradient = themeCssVars(themeById('polnoc'));
    expect(gradient['--chat-bg-image']).toContain('linear-gradient(180deg');

    const image = themeCssVars(themeById('miod'));
    expect(image['--chat-bg-image']).toBe('url(/chat-themes/images/miod.webp)');
    expect(image['--chat-bg-dim']).toBe('0.45');
  });
});

describe('kontrast WCAG', () => {
  it('liczy luminancję i współczynnik zgodnie ze wzorem', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 3);
    expect(contrastRatio('#7c3aed', '#ffffff')).toBeGreaterThan(5.5);
    expect(contrastRatio('#8b5cf6', '#ffffff')).toBeLessThan(WCAG_AA_TEXT);
    expect(Number.isNaN(relativeLuminance('var(--x)'))).toBe(true);
  });
});
