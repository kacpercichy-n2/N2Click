// Widok „Struktura" obszaru Zespół: automatycznie generowane drzewo organizacyjne
// z relacji przełożony → podwładny. Czysto prezentacyjny, read-only: brak
// przeciągania / zmiany podległości w tej iteracji. Logika drzewa (korzenie,
// cykle, sieroty) żyje w czystym selektorze `buildOrgChart` (teamScope.ts).
import { Link } from 'react-router-dom';
import type { Person } from '../types';
import { Avatar } from '../components/Avatar';
import { buildOrgChart, type OrgChartNode } from './teamScope';

/**
 * Renderuje drzewo struktury nad już zscope'owanym zbiorem osób. Węzeł to
 * awatar + nazwa + stanowisko; kliknięcie otwiera profil (/people/:id). Wady
 * danych (sieroty, cykle) obsługuje selektor — tu tylko oznaczamy cykl notą.
 */
export function TeamStructureTree({ people }: { people: Person[] }) {
  const personById = new Map(people.map((p) => [p.id, p]));
  const chart = buildOrgChart(
    people.map((p) => ({ id: p.id, name: p.name, supervisorId: p.supervisorId })),
  );

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

  return (
    <div className="team-structure">
      {chart.hasCycle && (
        <p className="field-hint team-structure-note" role="note">
          Wykryto cykl w relacji podległości. Osoby w cyklu pokazujemy na
          najwyższym poziomie i oznaczamy etykietą „cykl".
        </p>
      )}
      <div className="team-structure-scroll">
        <ul className="org-tree">
          {chart.roots.map((node) => (
            <OrgTreeNodeView key={node.id} node={node} personById={personById} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function OrgTreeNodeView({
  node,
  personById,
}: {
  node: OrgChartNode;
  personById: Map<string, Person>;
}) {
  const person = personById.get(node.id);
  return (
    <li className="org-node">
      {person ? (
        <Link to={`/people/${person.id}`} className="org-card" title={`Otwórz profil: ${person.name}`}>
          <Avatar person={person} size={36} />
          <span className="org-card-text">
            <span className="org-card-name">
              {person.name}
              {node.inCycle && <span className="org-cycle-tag">cykl</span>}
            </span>
            {person.role && <span className="org-card-role">{person.role}</span>}
          </span>
        </Link>
      ) : (
        <span className="org-card org-card-missing">(nieznana osoba)</span>
      )}
      {node.children.length > 0 && (
        <ul className="org-children">
          {node.children.map((child) => (
            <OrgTreeNodeView key={child.id} node={child} personById={personById} />
          ))}
        </ul>
      )}
    </li>
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
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: input.supervisorId,
    birthDate: '',
  };
}
