// SSR tests for the person-filter pieces: the multi-select popover section
// (PersonFilterSection), the compact ACTIVE-selection chips (ActivePersonChips)
// and the base PersonFilter's "Wszyscy" semantics. Pure react-dom/server render
// (node env, no DOM, no JSX) mirroring FilterBar.test.ts. Callbacks fire on real
// clicks, so we assert rendered structure/classes rather than invoking handlers.
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivePersonChips, PersonFilter, PersonFilterSection } from './PersonFilter';
import type { Person } from '../types';

const mkPerson = (id: string, name: string): Person => ({ id, name }) as unknown as Person;
const people = [
  mkPerson('p1', 'Ala'),
  mkPerson('p2', 'Bartek'),
  mkPerson('p3', 'Cezary'),
  mkPerson('p4', 'Dorota'),
  mkPerson('p5', 'Ewa'),
];

describe('PersonFilterSection — popover "Osoby" group', () => {
  it('wraps PersonFilter in a labelled fieldset with the "Wszyscy" chip', () => {
    const html = renderToStaticMarkup(
      h(PersonFilterSection, {
        people,
        selected: new Set<string>(),
        onToggle: () => {},
        onAll: () => {},
      }),
    );
    expect(html.startsWith('<fieldset class="filter-group"')).toBe(true);
    expect(html).toContain('<legend>Osoby</legend>');
    expect(html).toContain('person-filter');
    expect(html).toContain('Wszyscy');
    expect(html).toContain('Ala');
    expect(html).toContain('Ewa');
  });
});

describe('PersonFilter — "Wszyscy" semantics', () => {
  it('marks "Wszyscy" active when the selection is empty', () => {
    const html = renderToStaticMarkup(
      h(PersonFilter, {
        people,
        selected: new Set<string>(),
        onToggle: () => {},
        onAll: () => {},
      }),
    );
    // The first (Wszyscy) chip carries the active class.
    expect(html).toContain('<button type="button" class="filter-chip active">Wszyscy');
  });

  it('marks the selected person active and "Wszyscy" inactive', () => {
    const html = renderToStaticMarkup(
      h(PersonFilter, {
        people,
        selected: new Set(['p1']),
        onToggle: () => {},
        onAll: () => {},
      }),
    );
    expect(html).toContain('<button type="button" class="filter-chip">Wszyscy');
    // The selected person's chip is active (styled inline with their colour).
    expect(html).toMatch(/class="filter-chip active"[^>]*style="[^"]*"[^>]*>.*Ala/);
  });
});

describe('ActivePersonChips — compact active selection', () => {
  it('renders nothing when the selection is empty', () => {
    const html = renderToStaticMarkup(
      h(ActivePersonChips, { people, selected: new Set<string>(), onRemove: () => {} }),
    );
    expect(html).toBe('');
  });

  it('renders one removable chip per selected person, in list order', () => {
    const html = renderToStaticMarkup(
      h(ActivePersonChips, { people, selected: new Set(['p2', 'p1']), onRemove: () => {} }),
    );
    expect(html).toContain('person-active-chips');
    expect(html).toContain('aria-label="Usuń filtr osoby Ala"');
    expect(html).toContain('aria-label="Usuń filtr osoby Bartek"');
    // Unselected people never appear.
    expect(html).not.toContain('Cezary');
    // List order (Ala before Bartek), not Set-insertion order.
    expect(html.indexOf('Ala')).toBeLessThan(html.indexOf('Bartek'));
  });

  it('collapses the overflow past maxVisible into an informational "+N" chip', () => {
    const html = renderToStaticMarkup(
      h(ActivePersonChips, {
        people,
        selected: new Set(['p1', 'p2', 'p3', 'p4']),
        onRemove: () => {},
        maxVisible: 2,
      }),
    );
    // First two render as chips; the remaining two collapse to "+2".
    expect(html).toContain('aria-label="Usuń filtr osoby Ala"');
    expect(html).toContain('aria-label="Usuń filtr osoby Bartek"');
    expect(html).not.toContain('aria-label="Usuń filtr osoby Cezary"');
    expect(html).toContain('person-active-chip more');
    expect(html).toContain('+2');
  });
});
