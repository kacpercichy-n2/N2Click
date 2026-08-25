// Czysta arytmetyka motywu: katalog → zmienne CSS na korzeniu okna rozmowy,
// oraz kontrast WCAG (test katalogu + ewentualny skrypt walidujący).
//
// Zmienne mają w `styles.css` fallbacki na dzisiejsze tokeny, więc okno bez
// motywu (albo z nieznanym id) wygląda dokładnie jak dotąd. NIC nie jest
// globalne — zmienne siedzą na `.n2chat-window`, nigdy na `:root`.
import type { ChatTheme } from './catalog';

/** Katalog assetów motywów (Vite serwuje `public/` z korzenia). */
export const CHAT_THEME_ASSET_BASE = '/chat-themes/';

export type ChatThemeVars = Record<`--chat-${string}`, string>;

export function themeCssVars(theme: ChatTheme): ChatThemeVars {
  const [from, to] = theme.bubbleMine.gradient;
  const vars: ChatThemeVars = {
    '--chat-accent': theme.accent,
    '--chat-accent-text': theme.accentText,
    '--chat-bubble-mine-from': from,
    '--chat-bubble-mine-to': to,
    '--chat-bubble-mine-text': theme.bubbleMine.text,
    '--chat-bubble-theirs-bg': theme.bubbleTheirs.bg,
    '--chat-bubble-theirs-text': theme.bubbleTheirs.text,
    '--chat-bubble-theirs-border': theme.bubbleTheirs.border,
    '--chat-bg-color': backgroundBaseColor(theme.background),
    '--chat-bg-image': 'none',
    '--chat-bg-dim': '0',
    '--chat-pattern-mask': 'none',
    '--chat-pattern-size': 'auto',
    '--chat-pattern-opacity': '0',
  };
  const bg = theme.background;
  if (bg.kind === 'gradient') {
    vars['--chat-bg-image'] = `linear-gradient(${bg.angle}deg, ${bg.colors[0]}, ${bg.colors[1]})`;
  } else if (bg.kind === 'pattern') {
    vars['--chat-pattern-mask'] = `url(${CHAT_THEME_ASSET_BASE}${bg.asset})`;
    vars['--chat-pattern-size'] = `${bg.tile}px`;
    vars['--chat-pattern-opacity'] = String(bg.opacity);
  } else if (bg.kind === 'image') {
    vars['--chat-bg-image'] = `url(${CHAT_THEME_ASSET_BASE}${bg.asset})`;
    vars['--chat-bg-dim'] = String(bg.dim);
  }
  return vars;
}

function backgroundBaseColor(background: ChatTheme['background']): string {
  switch (background.kind) {
    case 'solid':
    case 'pattern':
    case 'image':
      return background.color;
    case 'gradient':
      return background.colors[0];
  }
}

// ---- Kontrast WCAG 2.x --------------------------------------------------------

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Luminancja względna koloru `#rrggbb` (0..1). Zły format => NaN. */
export function relativeLuminance(hex: string): number {
  const clean = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return Number.NaN;
  return 0.2126 * channel(clean, 0) + 0.7152 * channel(clean, 2) + 0.0722 * channel(clean, 4);
}

/** Współczynnik kontrastu dwóch kolorów `#rrggbb` (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Próg AA dla zwykłego tekstu. */
export const WCAG_AA_TEXT = 4.5;
