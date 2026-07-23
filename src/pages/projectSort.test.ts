// Unit tests for the pure Projects-page ordering helper (264): client groups
// alphabetical by client name (pl locale), projects alphabetical within a group,
// „Bez klienta" always last, input never mutated. Pure — no React, no store.
import { describe, expect, it } from 'vitest';
import { sortProjectGroups, type ProjectGroup } from './projectSort';

interface P {
  id: string;
  name: string;
}

function group(clientId: string, clientName: string, projects: P[]): ProjectGroup<P> {
  return { clientId, clientName, projects };
}

describe('sortProjectGroups', () => {
  it('sorts groups alphabetically by client name', () => {
    const out = sortProjectGroups([
      group('c2', 'Zenon', []),
      group('c1', 'Alfa', []),
      group('c3', 'Marek', []),
    ]);
    expect(out.map((g) => g.clientName)).toEqual(['Alfa', 'Marek', 'Zenon']);
  });

  it('sorts projects alphabetically within each group', () => {
    const [g] = sortProjectGroups([
      group('c1', 'Alfa', [
        { id: 'p1', name: 'Strona' },
        { id: 'p2', name: 'Baner' },
        { id: 'p3', name: 'Aplikacja' },
      ]),
    ]);
    expect(g.projects.map((p) => p.name)).toEqual(['Aplikacja', 'Baner', 'Strona']);
  });

  it('keeps „Bez klienta" (empty clientId) last even if its label sorts early', () => {
    const out = sortProjectGroups([
      group('', 'Bez klienta', [{ id: 'p1', name: 'Sierota' }]),
      group('c1', 'Zenon', []),
      group('c2', 'Alfa', []),
    ]);
    expect(out.map((g) => g.clientName)).toEqual(['Alfa', 'Zenon', 'Bez klienta']);
  });

  it('collates polskie znaki with the pl locale (ą after a, ł after l, ż last)', () => {
    const out = sortProjectGroups([
      group('c1', 'Żaba', []),
      group('c2', 'Łąka', []),
      group('c3', 'Ala', []),
      group('c4', 'Ćma', []),
    ]);
    expect(out.map((g) => g.clientName)).toEqual(['Ala', 'Ćma', 'Łąka', 'Żaba']);
  });

  it('does not mutate the input groups or their project arrays', () => {
    const projects: P[] = [
      { id: 'p1', name: 'Strona' },
      { id: 'p2', name: 'Baner' },
    ];
    const input = [group('c2', 'Zenon', []), group('c1', 'Alfa', projects)];
    const snapshotOrder = input.map((g) => g.clientName);
    const snapshotProjects = projects.map((p) => p.name);

    sortProjectGroups(input);

    expect(input.map((g) => g.clientName)).toEqual(snapshotOrder);
    expect(projects.map((p) => p.name)).toEqual(snapshotProjects);
  });
});
