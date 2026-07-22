// Composition tests for the reusable FilterBar toolbar. Pure SSR snapshotting
// via react-dom/server (react-dom is already a dependency; vitest runs in the
// `node` environment, so no DOM is needed). We assert the bar renders its
// passed-in sections inside ONE `.filter-toolbar` container, that the saved-
// filter "Zapisz filtr" control lands inside the bar, and that the `data-tour`
// anchor the onboarding tour relies on passes straight through. No store, no
// JSX (kept as `.test.ts` per the repo's include glob).
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterBar } from './FilterBar';

const basePanel = {
  groups: [],
  activeCount: 0,
  onClearAll: () => {},
  chips: [],
};

describe('FilterBar — composition', () => {
  it('wraps every section in a single .filter-toolbar container', () => {
    const html = renderToStaticMarkup(
      h(FilterBar, {
        dataTour: 'projects.filters',
        filterPanel: basePanel,
        personFilter: h('div', { className: 'marker-person' }, 'osoby'),
        presets: h('button', { type: 'button' }, 'Zapisz filtr'),
        trailing: h('span', { className: 'marker-count' }, '3 z 9'),
      }),
    );

    // Exactly one toolbar root, and it opens the markup (single container).
    expect(html.match(/filter-toolbar(?![-\w])/g) ?? []).toHaveLength(1);
    expect(html.startsWith('<div class="filter-toolbar"')).toBe(true);

    // FilterPanel is composed in (its "Filtry" button renders).
    expect(html).toContain('Filtry');
    // Person filter slot, presets slot and trailing slot are all present.
    expect(html).toContain('marker-person');
    expect(html).toContain('filter-toolbar-people');
    expect(html).toContain('filter-toolbar-presets');
    expect(html).toContain('marker-count');
  });

  it('renders the "Zapisz filtr" preset control inside the bar', () => {
    const html = renderToStaticMarkup(
      h(FilterBar, {
        filterPanel: basePanel,
        presets: h('button', { type: 'button', className: 'preset-save-btn' }, 'Zapisz filtr'),
      }),
    );
    const presetsIdx = html.indexOf('filter-toolbar-presets');
    const saveIdx = html.indexOf('Zapisz filtr');
    // Present, and nested within the presets wrapper (which is within the bar).
    expect(presetsIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(presetsIdx);
    expect(html.endsWith('</div>')).toBe(true);
  });

  it('passes data-tour through unchanged (onboarding anchor)', () => {
    const tasks = renderToStaticMarkup(
      h(FilterBar, { dataTour: 'tasks.filters', filterPanel: basePanel }),
    );
    expect(tasks).toContain('data-tour="tasks.filters"');
  });

  it('omits data-tour and optional slots when not provided', () => {
    const html = renderToStaticMarkup(h(FilterBar, { filterPanel: basePanel }));
    expect(html).not.toContain('data-tour');
    expect(html).not.toContain('filter-toolbar-people');
    expect(html).not.toContain('filter-toolbar-presets');
    expect(html).not.toContain('filter-toolbar-trailing');
  });
});
