// `tintVar` — the single CSS custom property that carries an entity colour into
// the stylesheet. The point of the helper is that the TINT (badge background,
// chip fill) is derived in CSS with color-mix(), so the JS side never touches
// the colour's notation. The old code concatenated a hex alpha suffix
// (`${color}1a`), which produced a valid colour ONLY for 6-digit hex — status
// colours come from the admin panel as free-form text, so `rgb(…)` or `#c9f`
// silently turned into an invalid declaration and the tint vanished.
import { describe, expect, it } from 'vitest';
import { personColor, registerPersonOrder, tintVar } from './colors';

describe('tintVar — status/person colour as one CSS variable', () => {
  it('passes a 6-digit hex through verbatim (the case the old code handled)', () => {
    expect(tintVar('--status', '#c496ff')).toEqual({ '--status': '#c496ff' });
  });

  it('passes a 3-digit hex through — the old `${color}1a` made `#c9f1a`', () => {
    expect(tintVar('--status', '#c9f')).toEqual({ '--status': '#c9f' });
  });

  it('passes 8-digit hex (own alpha) through without stacking a second alpha', () => {
    expect(tintVar('--status', '#c496ff80')).toEqual({ '--status': '#c496ff80' });
  });

  it.each([
    ['rgb(196, 150, 255)'],
    ['rgb(196 150 255)'],
    ['rgba(196, 150, 255, 0.8)'],
    ['hsl(270 100% 79%)'],
    ['oklch(0.78 0.16 300)'],
    ['rebeccapurple'],
  ])('passes the functional/named notation %s through unchanged', (color) => {
    expect(tintVar('--status', color)).toEqual({ '--status': color });
  });

  it('trims surrounding whitespace so a padded admin value stays valid CSS', () => {
    expect(tintVar('--status', '  #c496ff \n')).toEqual({ '--status': '#c496ff' });
  });

  it.each([[undefined], [null], [''], ['   ']])(
    'returns an EMPTY style for %p so the CSS var() fallback applies',
    (color) => {
      expect(tintVar('--status', color as string | null | undefined)).toEqual({});
    },
  );

  it('writes the requested variable name, so `--person` and `--status` do not mix', () => {
    expect(tintVar('--person', '#5b9dff')).toEqual({ '--person': '#5b9dff' });
    expect(Object.keys(tintVar('--person', '#5b9dff'))).toEqual(['--person']);
  });

  it('never emits `background` / `borderColor` — the tint lives in CSS', () => {
    const style = tintVar('--status', '#c496ff') as Record<string, unknown>;
    expect(Object.keys(style)).toEqual(['--status']);
    expect(style.background).toBeUndefined();
    expect(style.borderColor).toBeUndefined();
  });

  it('carries every palette colour of personColor (all 6-digit hex today)', () => {
    registerPersonOrder(['tv-p1', 'tv-p2', 'tv-p3']);
    for (const id of ['tv-p1', 'tv-p2', 'tv-p3']) {
      const color = personColor(id);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(tintVar('--person', color)).toEqual({ '--person': color });
    }
  });
});
