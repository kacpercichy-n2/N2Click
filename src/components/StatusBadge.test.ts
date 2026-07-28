// SSR tests for StatusBadge (node env, no DOM, no JSX — same shape as
// PersonFilter.test.ts). Two regressions are pinned here:
//  1. the status colour must leave JS as ONE custom property (`--status`), so a
//     non-6-digit-hex colour from the admin panel no longer breaks the tint;
//  2. the archived marker must be the shared POLISH label plus a
//     `data-archived` attribute — the badge used to append English
//     „ (archived)" in an otherwise Polish UI.
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './StatusBadge';
import { ARCHIVED_SUFFIX } from '../utils/archivedLabel';
import type { Status } from '../types';

const mkStatus = (o: Partial<Status>): Status =>
  ({
    id: 's1',
    name: 'Do zrobienia',
    slug: 'todo',
    color: '#c496ff',
    order: 0,
    archived: false,
    isDone: false,
    ...o,
  }) as Status;

const render = (status: Status | undefined) => renderToStaticMarkup(h(StatusBadge, { status }));

describe('StatusBadge — colour handoff to CSS', () => {
  it('renders nothing without a status', () => {
    expect(render(undefined)).toBe('');
  });

  it('passes the colour as the single `--status` variable, not as a background', () => {
    const html = render(mkStatus({ color: '#c496ff' }));
    expect(html).toContain('class="status-badge"');
    expect(html).toContain('style="--status:#c496ff"');
    // The old implementation emitted `background:#c496ff1a` plus border/color.
    expect(html).not.toContain('background');
    expect(html).not.toContain('border-color');
  });

  it.each([['#c9f'], ['rgb(196, 150, 255)'], ['hsl(270 100% 79%)'], ['rebeccapurple']])(
    'keeps a non-6-digit-hex colour (%s) intact instead of concatenating an alpha suffix',
    (color) => {
      const html = render(mkStatus({ color }));
      expect(html).toContain(`--status:${color}`);
      // The bug being fixed: `${color}1a` produced e.g. `rgb(196, 150, 255)1a`.
      expect(html).not.toContain(`${color}1a`);
    },
  );

  it('omits the style attribute for a blank colour so the CSS fallback applies', () => {
    const html = render(mkStatus({ color: '' }));
    expect(html).toContain('class="status-badge"');
    expect(html).not.toContain('style=');
  });
});

describe('StatusBadge — archived marker', () => {
  it('marks an archived status with data-archived and the Polish label', () => {
    const html = render(mkStatus({ name: 'Zrobione', archived: true }));
    expect(html).toContain('data-archived="true"');
    expect(html).toContain(`Zrobione${ARCHIVED_SUFFIX}`);
    expect(html).toContain('(zarchiwizowany)');
    // Regression: the English literal must be gone from a Polish UI.
    expect(html).not.toContain('(archived)');
  });

  it('adds neither the attribute nor a suffix for an active status', () => {
    const html = render(mkStatus({ name: 'Do zrobienia', archived: false }));
    expect(html).not.toContain('data-archived');
    expect(html).not.toContain('(zarchiwizowany)');
    expect(html).toContain('>Do zrobienia</span>');
  });
});
