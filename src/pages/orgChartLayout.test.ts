// Testy układu schematu organizacyjnego: wiersz wg rangi stanowiska, rozłączne
// przedziały poddrzew, rodzic na środku podwładnych oraz kształt łączników.
// Środowisko node, bez DOM.
import { describe, expect, it } from 'vitest';
import { buildOrgChart, type OrgChartInput } from './teamScope';
import {
  ORG_METRICS,
  layoutOrgChart,
  orderChildren,
  orgEdgePath,
  titleRow,
  type OrgLayoutPerson,
} from './orgChartLayout';

// Kadra odwzorowująca realny przypadek: zarząd tuż pod CEO, menedżerowie
// wiersz niżej, specjaliści na samym dole — w tym jeden raportujący wprost do
// CTO (jego podległość musi minąć wiersz menedżerów).
const CREW: Array<OrgChartInput & { role: string }> = [
  { id: 'ceo', name: 'Kamil Nowak', supervisorId: '', role: 'CEO – Chief Executive Officer' },
  { id: 'cto', name: 'Krzysztof Kostencki', supervisorId: 'ceo', role: 'CTO – Chief Technology Officer' },
  { id: 'coo', name: 'Wiktoria Przybylska', supervisorId: 'ceo', role: 'COO – Chief Operating Officer' },
  { id: 'acc', name: 'Marzena Sieradzka', supervisorId: 'ceo', role: 'Główna księgowa' },
  { id: 'mgr-a', name: 'Kacper Cichy', supervisorId: 'ceo', role: 'Menadżer Design i IT' },
  { id: 'mgr-b', name: 'Jarosław Drosik', supervisorId: 'ceo', role: 'Menadżer Produkcji' },
  { id: 'mgr-c', name: 'Dominik Niewiedział', supervisorId: 'ceo', role: 'Menadżer handlowy' },
  { id: 'spec-a', name: 'Zuzanna Maruda', supervisorId: 'mgr-a', role: 'Specjalistka' },
  { id: 'spec-b', name: 'Jakub Malinowski', supervisorId: 'cto', role: 'Specjalista Produkcja' },
];

const people: OrgLayoutPerson[] = CREW.map((c) => ({ id: c.id, role: c.role }));
const layout = () => layoutOrgChart(buildOrgChart(CREW).roots, people);
const byId = (id: string) => layout().nodes.find((n) => n.id === id)!;

describe('titleRow — wiersz wynikający ze stanowiska', () => {
  it('zarząd i wsparcie tuż pod korzeniem', () => {
    expect(titleRow('CTO – Chief Technology Officer')).toBe(1);
    expect(titleRow('Główna księgowa')).toBe(1);
  });

  it('menedżerowie i kierownicy jeden wiersz niżej', () => {
    expect(titleRow('Menadżer Produkcji')).toBe(2);
    expect(titleRow('Menedżer handlowy')).toBe(2);
    expect(titleRow('Kierownik magazynu')).toBe(2);
  });

  it('reszta stanowisk w wierszu specjalistów', () => {
    expect(titleRow('Specjalista Produkcja')).toBe(3);
    expect(titleRow('')).toBe(3);
  });
});

describe('orderChildren — zarząd na skraje, linia w środek', () => {
  const node = (id: string) => ({ id, inCycle: false, children: [] });

  it('pierwszy zarząd na lewo, drugi na prawo, linia pośrodku', () => {
    const roles = new Map([
      ['cto', 'CTO'],
      ['coo', 'COO'],
      ['m1', 'Menadżer Produkcji'],
      ['m2', 'Menadżer handlowy'],
    ]);
    const order = orderChildren([node('cto'), node('coo'), node('m1'), node('m2')], roles);
    expect(order.map((n) => n.id)).toEqual(['cto', 'm1', 'm2', 'coo']);
  });

  it('bez zarządu kolejność wejściowa zostaje nienaruszona', () => {
    const roles = new Map([['m1', 'Menadżer'], ['m2', 'Menadżer']]);
    expect(orderChildren([node('m1'), node('m2')], roles).map((n) => n.id)).toEqual(['m1', 'm2']);
  });
});

describe('layoutOrgChart', () => {
  it('stawia każdą osobę w wierszu wynikającym z jej rangi', () => {
    expect(byId('ceo').row).toBe(0);
    expect(byId('cto').row).toBe(1);
    expect(byId('coo').row).toBe(1);
    expect(byId('acc').row).toBe(1);
    expect(byId('mgr-a').row).toBe(2);
    expect(byId('mgr-c').row).toBe(2);
    // Podwładny CTO jest specjalistą, więc stoi w wierszu specjalistów —
    // NIE tuż pod przełożonym.
    expect(byId('spec-a').row).toBe(3);
    expect(byId('spec-b').row).toBe(3);
  });

  it('wiersze mają wspólną wysokość, karty w wierszu wspólne y', () => {
    const rows = new Map<number, number[]>();
    for (const n of layout().nodes) rows.set(n.row, [...(rows.get(n.row) ?? []), n.y]);
    for (const ys of rows.values()) expect(new Set(ys).size).toBe(1);
  });

  it('podległość mijająca wiersz jest oznaczona jako `skip`', () => {
    const edges = layout().edges;
    expect(edges.find((e) => e.toId === 'spec-b')).toEqual({
      fromId: 'cto',
      toId: 'spec-b',
      kind: 'skip',
    });
    // Zarząd wisi tuż pod CEO, więc jego krawędzie są zwykłe; menedżerowie
    // stoją wiersz niżej niż zarząd, więc ich pion też mija wiersz.
    expect(edges.find((e) => e.toId === 'cto')?.kind).toBe('direct');
    expect(edges.find((e) => e.toId === 'spec-a')?.kind).toBe('direct');
    expect(edges.find((e) => e.toId === 'mgr-a')?.kind).toBe('skip');
  });

  it('wsparcie „na uboczu" nie ma krawędzi i stoi na prawym skraju', () => {
    const { nodes, edges } = layout();
    const acc = nodes.find((n) => n.id === 'acc')!;
    expect(acc.aside).toBe(true);
    expect(edges.some((e) => e.toId === 'acc')).toBe(false);
    for (const other of nodes) {
      if (other.id !== 'acc') expect(other.x).toBeLessThan(acc.x);
    }
  });

  it('karty w jednym wierszu nigdy na siebie nie nachodzą', () => {
    const { nodes } = layout();
    for (const row of new Set(nodes.map((n) => n.row))) {
      const inRow = nodes.filter((n) => n.row === row).sort((a, b) => a.x - b.x);
      for (let i = 1; i < inRow.length; i++) {
        expect(inRow[i].x).toBeGreaterThanOrEqual(inRow[i - 1].x + ORG_METRICS.cardWidth);
      }
    }
  });

  it('przełożony stoi na środku swoich podwładnych', () => {
    const { nodes, edges } = layout();
    const center = (id: string) => nodes.find((n) => n.id === id)!.x + ORG_METRICS.cardWidth / 2;
    for (const parent of ['ceo', 'cto', 'mgr-a']) {
      const kids = edges.filter((e) => e.fromId === parent).map((e) => center(e.toId));
      const expected = (Math.min(...kids) + Math.max(...kids)) / 2;
      expect(center(parent)).toBeCloseTo(expected, 5);
    }
  });

  it('zarząd otacza kaskadę menedżerów', () => {
    const { nodes } = layout();
    const x = (id: string) => nodes.find((n) => n.id === id)!.x;
    expect(x('cto')).toBeLessThan(x('mgr-a'));
    expect(x('coo')).toBeGreaterThan(x('mgr-c'));
  });

  it('rozmiar płótna obejmuje wszystkie karty z marginesem', () => {
    const { nodes, width, height } = layout();
    for (const n of nodes) {
      expect(n.x + ORG_METRICS.cardWidth).toBeLessThanOrEqual(width - ORG_METRICS.padding);
      expect(n.y + ORG_METRICS.cardHeight).toBeLessThanOrEqual(height - ORG_METRICS.padding);
    }
  });

  it('pusty las => puste płótno', () => {
    expect(layoutOrgChart([], [])).toEqual({ nodes: [], edges: [], width: 32, height: 32 });
  });
});

describe('orgEdgePath', () => {
  const node = (x: number, row: number) => ({
    id: 'n',
    x,
    y: ORG_METRICS.padding + row * (ORG_METRICS.cardHeight + ORG_METRICS.rowGap),
    row,
    inCycle: false,
    aside: false,
  });

  it('ta sama kolumna => prosty pion', () => {
    expect(orgEdgePath(node(100, 0), node(100, 1))).toMatch(/^M \d+ \d+ V \d+$/);
  });

  it('inna kolumna => pion, kolanko, poziom, kolanko, pion', () => {
    const d = orgEdgePath(node(100, 0), node(600, 1));
    expect(d).toContain('V');
    expect(d).toContain('H');
    expect(d.match(/Q/g)).toHaveLength(2);
  });

  it('krawędź przez wiersz skręca dopiero nad kartą podwładnego', () => {
    const d = orgEdgePath(node(100, 1), node(600, 3));
    const turn = Number(d.split(' V ')[1].split(' ')[0]);
    const childTop = node(600, 3).y;
    expect(childTop - turn).toBeLessThanOrEqual(ORG_METRICS.rowGap);
  });
});
