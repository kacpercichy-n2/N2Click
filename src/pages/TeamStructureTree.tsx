// Widok „Struktura" obszaru Zespół: automatycznie generowany schemat
// organizacyjny z relacji przełożony → podwładny. Czysto prezentacyjny,
// read-only: brak przeciągania / zmiany podległości w tej iteracji.
//
// Podział odpowiedzialności:
// - `buildOrgChart` (teamScope.ts) — las podległości, cykle, sieroty;
// - `layoutOrgChart` (orgChartLayout.ts) — wiersze, pozycje kart i krawędzie;
// - ten plik — wyłącznie render policzonego układu.
//
// Wiersz osoby wynika z RANGI STANOWISKA, nie z głębokości w drzewie, więc
// specjalista raportujący wprost do zarządu stoi w wierszu specjalistów, a
// jego podległość rysuje linia mijająca wiersz menedżerów. Takich krawędzi nie
// da się złożyć z obramowań zagnieżdżonych list — stąd jedno płótno SVG pod
// kartami. SVG jest `aria-hidden`; strukturę dla czytnika ekranu niesie
// `role="tree"` + `aria-level` na kartach, a kolejność DOM to obejście drzewa
// w głąb (czyli sensowna kolejność tabulacji).
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Person } from '../types';
import { Avatar } from '../components/Avatar';
import { Tooltip } from '../components/Tooltip';
import { buildOrgChart } from './teamScope';
import { ORG_METRICS, layoutOrgChart, orgEdgePath, type OrgLayoutNode } from './orgChartLayout';

/**
 * Renderuje schemat nad już zscope'owanym zbiorem osób. Węzeł to awatar +
 * nazwa + stanowisko; kliknięcie otwiera profil (/people/:id). Wady danych
 * (sieroty, cykle) obsługuje selektor — tu tylko oznaczamy cykl notą.
 */
export function TeamStructureTree({ people }: { people: Person[] }) {
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const chart = useMemo(
    () =>
      buildOrgChart(
        people.map((p) => ({ id: p.id, name: p.name, supervisorId: p.supervisorId })),
      ),
    [people],
  );
  const layout = useMemo(
    () =>
      layoutOrgChart(
        chart.roots,
        people.map((p) => ({ id: p.id, role: p.role })),
      ),
    [chart, people],
  );

  // Jedyny zapis do DOM w tym widoku: schemat jest szerszy niż karta na wąskim
  // ekranie, a startowy `scrollLeft = 0` pokazywałby lewe skrzydło z korzeniem
  // poza kadrem. Jednorazowo po zamontowaniu (i po zmianie składu osób)
  // ustawiamy kadr na środku — bez obserwatorów i bez pętli pomiarów.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rosterKey = people.map((p) => p.id).join('|');
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  }, [rosterKey]);

  if (chart.roots.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">Brak osób do wyświetlenia</p>
        <p className="empty-hint">
          Twoja rola nie obejmuje żadnej osoby w strukturze zespołu.
        </p>
      </div>
    );
  }

  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));

  return (
    <div className="team-structure">
      {chart.hasCycle && (
        <p className="field-hint team-structure-note" role="note">
          Wykryto cykl w relacji podległości. Osoby w cyklu pokazujemy na
          najwyższym poziomie i oznaczamy etykietą „cykl".
        </p>
      )}
      <div className="team-structure-scroll" ref={scrollRef}>
        <div
          className="org-chart"
          role="tree"
          aria-label="Schemat organizacyjny"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            className="org-edges"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
            focusable="false"
          >
            {layout.edges.map((edge) => {
              const from = nodeById.get(edge.fromId);
              const to = nodeById.get(edge.toId);
              if (from === undefined || to === undefined) return null;
              return (
                <path
                  key={`${edge.fromId}-${edge.toId}`}
                  className={`org-edge org-edge-${edge.kind}`}
                  d={orgEdgePath(from, to)}
                />
              );
            })}
          </svg>
          {layout.nodes.map((node) => (
            <OrgCard key={node.id} node={node} person={personById.get(node.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Pojedyncza karta osoby, pozycjonowana wynikiem układu. */
function OrgCard({ node, person }: { node: OrgLayoutNode; person: Person | undefined }) {
  // Rozmiar karty bierze się z metryk układu — CSS nie może go nadpisać, bo
  // pozycje sąsiadów są już policzone dokładnie na tych wymiarach.
  const style = {
    left: node.x,
    top: node.y,
    width: ORG_METRICS.cardWidth,
    height: ORG_METRICS.cardHeight,
  };
  const className = [
    'org-card',
    node.row === 0 ? 'org-card-lead' : '',
    node.aside ? 'org-card-aside' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (person === undefined) {
    return (
      <span className={`${className} org-card-missing`} style={style} role="treeitem" aria-level={node.row + 1}>
        (nieznana osoba)
      </span>
    );
  }
  return (
    <Tooltip text={`Otwórz profil: ${person.name}`}>
      <Link
        to={`/people/${person.id}`}
        className={className}
        style={style}
        role="treeitem"
        aria-level={node.row + 1}
      >
        <span className="org-card-avatar">
          <Avatar person={person} size={node.row === 0 ? 56 : 48} />
        </span>
        <span className="org-card-text">
          <span className="org-card-name">
            {person.name}
            {node.inCycle && <span className="org-cycle-tag">cykl</span>}
          </span>
          {person.role && <span className="org-card-role">{person.role}</span>}
        </span>
      </Link>
    </Tooltip>
  );
}

/**
 * Minimalny obiekt `Person` na potrzeby awatara i linku profilu (tryb chmury,
 * gdzie źródłem są `CloudProfile`, nie lokalny store). Wypełniamy tylko pola
 * czytane przez `Avatar` i nawigację; reszta to bezpieczne wartości domyślne.
 */
export function personForTreeNode(input: {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  supervisorId: string;
}): Person {
  return {
    id: input.id,
    firstName: input.firstName,
    lastName: input.lastName,
    name: input.name,
    email: input.email,
    phone: '',
    role: input.role,
    departmentId: '',
    avatar: input.avatar,
    capacity: 8,
    accessRole: 'pelne',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: input.supervisorId,
    birthDate: '',
  };
}
