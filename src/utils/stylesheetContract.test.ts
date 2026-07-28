// Regression guards for stylesheet-level contracts that no component test can
// see. They read `styles.css` as text (virtual module from `vitest.config.ts`,
// because Vitest stubs CSS imports) — cheap, and the alternative (a real browser
// with `prefers-reduced-motion` forced) belongs to the release matrix.
//
//  1. RUCH (W08) jest opt-in: każdy czas trwania przechodzi przez mnożnik
//     `--n2-motion`, który wynosi 0 dopóki `@media (prefers-reduced-motion:
//     no-preference)` go nie włączy. Dawny globalny reset
//     `* { animation-duration: .01ms !important }` nie zatrzymywał animacji,
//     tylko je przyspieszał, i nie dotykał animacji z JS.
//  2. KONTRAST (TY-06): `--n2-text-faint` jest najsłabszym kolorem TEKSTU i
//     musi przechodzić AA; `--n2-text-disabled` jest osobnym, słabszym tokenem
//     wyłącznie dla stanów zablokowanych i ikon ≥ 16 px.
import { describe, expect, it } from 'vitest';
import css from 'virtual:styles-css';

const APP_BG = [0x01, 0x01, 0x01]; // --n2-bg (--n2-night)
const CARD_BG = [19, 18, 23]; // --card-bg (white 4%) composited over --n2-bg

/** WCAG contrast of `--n2-text` (#fbf8ff) at `alpha` over an opaque backdrop. */
function contrastOver(alpha: number, bg: readonly number[]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (rgb: readonly number[]) =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const composited = [0xfb, 0xf8, 0xff].map((fg, i) => fg * alpha + bg[i] * (1 - alpha));
  const [hi, lo] = [lum(composited), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const declaredAlpha = (token: string): number => {
  const m = css.match(new RegExp(`--${token}:\\s*rgba\\(251, 248, 255, ([0-9.]+)\\)`));
  if (!m) throw new Error(`token --${token} not found in styles.css`);
  return Number(m[1]);
};

describe('reduced motion is opt-in (W08)', () => {
  it('drops the global !important duration reset', () => {
    expect(css).not.toContain('0.01ms');
    expect(css).not.toMatch(/animation-duration:[^;]*!important/);
    expect(css).not.toMatch(/transition-duration:[^;]*!important/);
  });

  it('enables motion only inside @media (prefers-reduced-motion: no-preference)', () => {
    expect(css).toContain('--n2-motion: 0;');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*:root \{\s*--n2-motion: 1;/,
    );
    // No `reduce` branch may come back — it would re-create the opt-out pattern.
    expect(css).not.toContain('prefers-reduced-motion: reduce');
  });

  it('routes EVERY duration through the --n2-motion multiplier', () => {
    // Any `123ms` / `0.15s` token in a property/shorthand value must sit inside
    // `calc(... * var(--n2-motion))`. Comments are stripped first.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const durations = code.match(/[\d.]+m?s(?=[\s,)])/g) ?? [];
    expect(durations.length).toBeGreaterThan(5);
    const wrapped = code.match(/calc\([\d.]+m?s \* var\(--n2-motion\)\)/g) ?? [];
    expect(wrapped.length).toBe(durations.length);
  });
});

describe('faint/disabled text tokens (TY-06)', () => {
  it('lifts --n2-text-faint from ~2.9:1 to the AA range', () => {
    const alpha = declaredAlpha('n2-text-faint');
    expect(alpha).toBeGreaterThanOrEqual(0.46);
    // Pełne AA (4,5:1) na powierzchni karty — a KAŻDA reguła używająca tego
    // tokenu (oś godzin, puste stany, pola, popovery) leży na `--card-bg`
    // albo na jaśniejszym szkle, nigdy na samym tle strony.
    expect(contrastOver(alpha, CARD_BG)).toBeGreaterThanOrEqual(4.5);
    // Na samym `--n2-bg` (najciemniejszy możliwy podkład) wychodzi 4,41:1 —
    // wciąż 1,5× więcej niż przed zmianą; gdyby jakaś reguła zjechała na czyste
    // tło strony, potrzebowałaby 0,48.
    expect(contrastOver(alpha, APP_BG)).toBeGreaterThan(4.4);
    // Sanity: the old value really was below every threshold.
    expect(contrastOver(0.34, APP_BG)).toBeLessThan(3);
  });

  it('keeps --n2-text-disabled as a separate, weaker non-text token', () => {
    const disabled = declaredAlpha('n2-text-disabled');
    expect(disabled).toBeLessThan(declaredAlpha('n2-text-faint'));
    expect(disabled).toBe(0.3);
  });

  it('never uses --n2-text-disabled for a `color` on 11 px text rules', () => {
    // The token is allowed on `color` for ≥16 px icons only; the three 11 px
    // offenders (search group heads, filter legends) moved to `muted`.
    expect(css).toMatch(/\.gs-group-head \{[^}]*color: var\(--n2-text-muted\)/);
    expect(css).toMatch(/\.filter-group legend \{[^}]*color: var\(--n2-text-muted\)/);
    expect(css).not.toMatch(/--n2-text-disabled[\s\S]{0,80}--n2-type-xs/);
  });
});

describe('status/person tints are derived in CSS, not concatenated in JS', () => {
  it('mixes the --status variable for the badge background', () => {
    expect(css).toMatch(
      /\.status-badge \{[^}]*background: color-mix\(in oklab, var\(--status, transparent\) 10\.196%, transparent\)/,
    );
  });

  it('mixes the --person variable for tinted chips', () => {
    expect(css).toMatch(
      /\.person-active-chip\.person-tint \{[^}]*background: color-mix\(in oklab, var\(--person, transparent\) 13\.333%, transparent\)/,
    );
  });
});
