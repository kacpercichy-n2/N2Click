// Układ schematu organizacyjnego: czysta warstwa obliczeń (bez Reacta i DOM),
// testowalna w node. Widok `TeamStructureTree` tylko renderuje jej wynik.
//
// Dlaczego warstwy, a nie zwykłe zagnieżdżenie:
// wiersz osoby wynika z RANGI STANOWISKA, nie z głębokości w drzewie
// podległości. Specjalista raportujący wprost do zarządu ma stać w wierszu
// specjalistów, a jego podległość rysujemy linią, która MIJA wiersz
// menedżerów. Zagnieżdżony układ (lista w liście) tego nie potrafi — stąd
// pozycje liczone tutaj i krawędzie rysowane w SVG.
//
// Niezmienniki układu:
// 1. Poddrzewa zajmują ROZŁĄCZNE przedziały poziome, więc karty nigdy na
//    siebie nie nachodzą, a pion krawędzi „przez wiersz" biegnie pustą
//    kolumną rodzica.
// 2. Rodzic stoi w poziomie na środku swoich podwładnych.
// 3. Wiersz = max(wiersz przełożonego + 1, wiersz wynikający ze stanowiska) —
//    nikt nie ląduje wyżej niż jego przełożony.
import { orgRoleRank, type OrgChartNode } from './teamScope';

/** Wymiary schematu. Jedno źródło prawdy dla obliczeń i dla CSS. */
export interface OrgMetrics {
  cardWidth: number;
  cardHeight: number;
  /** Odstęp poziomy między sąsiednimi kartami w wierszu. */
  columnGap: number;
  /** Pionowa przerwa między dolną krawędzią wiersza a górną następnego. */
  rowGap: number;
  /** Margines wokół całego schematu (mieści też awatar nad kartą). */
  padding: number;
  /** Promień zaokrąglenia kolanek łączników. */
  cornerRadius: number;
  /** O ile awatar wystaje ponad kartę — łącznik kończy się na jego krawędzi. */
  avatarRise: number;
}

export const ORG_METRICS: OrgMetrics = {
  cardWidth: 240,
  cardHeight: 92,
  columnGap: 24,
  rowGap: 76,
  padding: 32,
  cornerRadius: 12,
  avatarRise: 26,
};

/** Dane osoby potrzebne układowi: tylko stanowisko decyduje o wierszu. */
export interface OrgLayoutPerson {
  id: string;
  role: string;
}

/** Karta na schemacie: `x`/`y` to lewy górny róg, `row` — numer wiersza. */
export interface OrgLayoutNode {
  id: string;
  x: number;
  y: number;
  row: number;
  inCycle: boolean;
  /** `aside` stoi obok kaskady i nie ma narysowanej podległości. */
  aside: boolean;
}

/** Krawędź podległości. `skip` = przeskakuje co najmniej jeden wiersz. */
export interface OrgLayoutEdge {
  fromId: string;
  toId: string;
  kind: 'direct' | 'skip';
}

export interface OrgLayout {
  nodes: OrgLayoutNode[];
  edges: OrgLayoutEdge[];
  width: number;
  height: number;
}

/**
 * Wiersz wynikający z samego stanowiska: zarząd i wsparcie tuż pod korzeniem,
 * menedżerowie niżej, reszta jeszcze niżej. Korzeń zawsze dostaje wiersz 0 —
 * ta funkcja opisuje tylko podwładnych.
 */
export function titleRow(role: string): number {
  const rank = orgRoleRank(role);
  if (rank === 'chief' || rank === 'aside') return 1;
  if (/^(menad[żz]er|mened[żz]er|manager|kierowni[kc])/i.test(role.trim())) return 2;
  return 3;
}

/**
 * Kolejność podwładnych w poziomie: zarząd rozchodzi się na SKRAJE (pierwszy
 * na lewo, drugi na prawo, kolejne naprzemiennie), linia operacyjna zostaje w
 * środku. Dzięki temu pion przełożonego schodzi między zarządem prosto do
 * szyny menedżerów — tak jak na firmowym org charcie.
 */
export function orderChildren(
  children: ReadonlyArray<OrgChartNode>,
  roleById: ReadonlyMap<string, string>,
): OrgChartNode[] {
  const rank = (n: OrgChartNode): string => orgRoleRank(roleById.get(n.id) ?? '');
  const chiefs = children.filter((c) => rank(c) === 'chief');
  const line = children.filter((c) => rank(c) === 'line');
  const left = chiefs.filter((_, i) => i % 2 === 0);
  const right = chiefs.filter((_, i) => i % 2 === 1);
  return [...left, ...line, ...right];
}

/**
 * Liczy pozycje kart i krawędzie. `roots` to las z `buildOrgChart` (cykle już
 * rozcięte), `people` daje stanowiska. Węzły `aside` (wsparcie, np. główna
 * księgowa) są wyjmowane z kaskady i dostawiane na prawym skraju swojego
 * wiersza — bez krawędzi, bo świadomie stoją obok linii decyzyjnej.
 */
export function layoutOrgChart(
  roots: ReadonlyArray<OrgChartNode>,
  people: ReadonlyArray<OrgLayoutPerson>,
  metrics: OrgMetrics = ORG_METRICS,
): OrgLayout {
  const roleById = new Map(people.map((p) => [p.id, p.role]));
  const slotWidth = metrics.cardWidth + metrics.columnGap;
  const nodes: OrgLayoutNode[] = [];
  const edges: OrgLayoutEdge[] = [];
  const asides: Array<{ node: OrgChartNode; row: number }> = [];

  let nextSlot = 0;
  const centerOfSlot = (slot: number): number =>
    metrics.padding + slot * slotWidth + metrics.cardWidth / 2;

  // Zwraca poziomy środek karty węzła; dzieci układa wcześniej, więc rodzic
  // zna już ich zakres. Rekurencja idzie po rozłącznych przedziałach slotów.
  const place = (node: OrgChartNode, row: number): number => {
    const kids = orderChildren(node.children, roleById).filter(
      (c) => orgRoleRank(roleById.get(c.id) ?? '') !== 'aside',
    );
    for (const child of node.children) {
      if (orgRoleRank(roleById.get(child.id) ?? '') !== 'aside') continue;
      asides.push({ node: child, row: Math.max(row + 1, titleRow(roleById.get(child.id) ?? '')) });
    }

    const childCenters: number[] = [];
    for (const child of kids) {
      const childRow = Math.max(row + 1, titleRow(roleById.get(child.id) ?? ''));
      childCenters.push(place(child, childRow));
      edges.push({
        fromId: node.id,
        toId: child.id,
        kind: childRow === row + 1 ? 'direct' : 'skip',
      });
    }

    const center =
      childCenters.length === 0
        ? centerOfSlot(nextSlot++)
        : (childCenters[0] + childCenters[childCenters.length - 1]) / 2;

    nodes.push({
      id: node.id,
      x: center - metrics.cardWidth / 2,
      y: metrics.padding + row * (metrics.cardHeight + metrics.rowGap),
      row,
      inCycle: node.inCycle,
      aside: false,
    });
    return center;
  };

  for (const root of roots) place(root, 0);

  // Wsparcie „na uboczu": prawy skraj, w swoim wierszu, bez krawędzi.
  if (asides.length > 0) {
    let x = nodes.reduce((max, n) => Math.max(max, n.x + metrics.cardWidth), metrics.padding);
    for (const { node, row } of asides) {
      x += metrics.columnGap * 2;
      nodes.push({
        id: node.id,
        x,
        y: metrics.padding + row * (metrics.cardHeight + metrics.rowGap),
        row,
        inCycle: node.inCycle,
        aside: true,
      });
      x += metrics.cardWidth;
    }
  }

  const width = nodes.reduce((max, n) => Math.max(max, n.x + metrics.cardWidth), 0) + metrics.padding;
  const height =
    nodes.reduce((max, n) => Math.max(max, n.y + metrics.cardHeight), 0) + metrics.padding;
  return { nodes, edges, width, height };
}

/**
 * Ścieżka SVG jednego łącznika: pion z dołu karty przełożonego, kolanko, poziom
 * i pion do KRAWĘDZI AWATARA podwładnego. Zatrzymanie na awatarze (zamiast na
 * krawędzi karty) jest konieczne, bo awatar jest wyśrodkowany nad kartą, czyli
 * dokładnie na torze pionu — linia dobiegająca głębiej chowałaby się za
 * bąbelkiem i zostawiała nad nim kikut. Krawędź `skip` prowadzi pion PRZEZ
 * mijane wiersze w kolumnie przełożonego (z niezmiennika 1 wiemy, że jest
 * pusta) i skręca dopiero tuż nad podwładnym.
 */
export function orgEdgePath(
  from: OrgLayoutNode,
  to: OrgLayoutNode,
  metrics: OrgMetrics = ORG_METRICS,
): string {
  const startX = from.x + metrics.cardWidth / 2;
  const startY = from.y + metrics.cardHeight;
  const endX = to.x + metrics.cardWidth / 2;
  const endY = to.y - metrics.avatarRise;
  // Skręt tuż nad kartą podwładnego dla krawędzi przez wiersz, w połowie
  // przerwy dla zwykłej — tak zwykłe rozgałęzienia dzielą wspólną szynę.
  const turnY = endY - metrics.rowGap / 2;

  if (Math.abs(endX - startX) < 0.5) return `M ${startX} ${startY} V ${endY}`;

  const r = Math.min(metrics.cornerRadius, Math.abs(endX - startX) / 2, (endY - turnY) / 2);
  const dir = endX > startX ? 1 : -1;
  return [
    `M ${startX} ${startY}`,
    `V ${turnY - r}`,
    `Q ${startX} ${turnY} ${startX + dir * r} ${turnY}`,
    `H ${endX - dir * r}`,
    `Q ${endX} ${turnY} ${endX} ${turnY + r}`,
    `V ${endY}`,
  ].join(' ');
}
