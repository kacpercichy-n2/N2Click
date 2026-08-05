// Utajniona treść (zarząd) — JEDYNE miejsce z regułami „kto widzi treść".
//
// Encja z `isConfidential: true` (zadanie / projekt / wydarzenie) pokazuje
// osobom bez wglądu wyłącznie fakty planistyczne (terminy, godziny, osoby);
// tytuł zastępuje stabilna etykieta „Zadanie #N" itd., a opis / checklista /
// dyskusja / lokalizacja są ukrywane w warstwie renderowania.
//
// Wgląd w treść mają:
// - ZARZĄD: osoba z działu o nazwie „Zarząd" (dokładnie, po trim i małych
//   literach pl) LUB ze stanowiskiem zaczynającym się od CEO/COO/CTO — ten sam
//   parser head-tokenu co `orgRoleRank` (src/pages/teamScope.ts), celowo
//   ZAWĘŻONY do trzech tytułów z decyzji produktowej;
// - przypisany WYKONAWCA zadania (`TaskAssignment`) — a przez to również
//   projektu, do którego dowolnego zadania jest przypisany;
// - jawnie wskazany UCZESTNIK wydarzenia. `attendeeIds: []` (ogólnofirmowe)
//   NIE daje wyjątku — wtedy treść widzi wyłącznie zarząd.
//
// `accessRole` / `isAdminUser` celowo NIE mają tu głosu: administrator bez
// sygnałów zarządu widzi maskę jak każdy inny (wymaganie zgłoszenia).
//
// To bramka WYŁĄCZNIE prezentacyjna po stronie klienta (jak `events.manage` —
// patrz nagłówek RLS w migracji 20260721210000_events.sql). Store trzyma
// zawsze PRAWDZIWE dane, bo `cloudMirror` diffuje stan i zapisałby maskę do
// chmury — dlatego ten moduł wolno wołać tylko z selektorów i miejsc renderu,
// nigdy przy budowaniu stanu.
//
// Moduł importuje tylko `types` i `selectorCache` (bez cyklu z `selectors.ts`).
import type { AppData, CalendarEvent, Person, Project, Task } from '../types';
import { createRefCache } from './selectorCache';

/** Skróty zarządu — świadomy PODZBIÓR `CHIEF_TITLES` z teamScope (CFO/CIO/…
 *  rysują się w schemacie jako zarząd, ale wglądu w utajnione treści nie mają). */
const BOARD_TITLES = ['CEO', 'COO', 'CTO'];

/** Znormalizowana nazwa działu zarządu. „Zarządzanie" z seeda NIE pasuje. */
const BOARD_DEPARTMENT_NAME = 'zarząd';

/** Stanowisko zaczyna się od CEO/COO/CTO („CTO – Chief Technology Officer",
 *  „COO-cokolwiek", samo „CEO"). Parser head-tokenu jak `orgRoleRank`. */
export function isBoardTitle(roleTitle: string): boolean {
  const head = roleTitle.trim().split(/[\s–—-]/, 1)[0]?.toUpperCase() ?? '';
  return BOARD_TITLES.includes(head);
}

/** Dział jest działem zarządu: nazwa po trim i małych literach pl to dokładnie
 *  „zarząd". '' (brak działu) nigdy nie pasuje. */
export function isBoardDepartment(state: AppData, departmentId: string): boolean {
  if (departmentId === '') return false;
  const dept = state.departments.find((d) => d.id === departmentId);
  if (!dept) return false;
  return dept.name.trim().toLocaleLowerCase('pl') === BOARD_DEPARTMENT_NAME;
}

/** Osoba należy do zarządu: dział „Zarząd" LUB stanowisko CEO/COO/CTO. */
export function isBoardPerson(state: AppData, person: Person | undefined): boolean {
  if (!person) return false;
  return isBoardTitle(person.role) || isBoardDepartment(state, person.departmentId);
}

/** Bieżący użytkownik należy do zarządu. Pusty `currentUserId` => false. */
export function isBoardMember(state: AppData): boolean {
  if (state.currentUserId === '') return false;
  return isBoardPerson(
    state,
    state.people.find((p) => p.id === state.currentUserId),
  );
}

interface ConfidentialLabels {
  task: Map<string, string>; // id -> 'Zadanie #N'
  project: Map<string, string>; // id -> 'Projekt #N'
  event: Map<string, string>; // id -> 'Wydarzenie #N'
}

/** Deterministyczny porządek numeracji: (createdAt, id) rosnąco — ten sam we
 *  wszystkich przeglądarkach niezależnie od kolejności hydracji. */
function orderKey(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function buildLabels<T extends { id: string; createdAt: string }>(
  rows: T[],
  isConfidential: (row: T) => boolean,
  noun: string,
): Map<string, string> {
  const confidential = rows.filter(isConfidential);
  confidential.sort(orderKey);
  const labels = new Map<string, string>();
  confidential.forEach((row, index) => {
    labels.set(row.id, `${noun} #${index + 1}`);
  });
  return labels;
}

/** Zadanie jest utajnione własną flagą LUB dziedziczy utajnienie ze swojego
 *  projektu — tytuły zadań są częścią treści projektu, więc utajniony projekt
 *  maskuje także tytuły swoich zadań (wyjątki wglądu liczą się osobno). */
function taskIsConfidential(state: AppData, task: Task): boolean {
  if (task.isConfidential === true) return true;
  const project = state.projects.find((p) => p.id === task.projectId);
  return project !== undefined && project.isConfidential === true;
}

/** Etykiety maskujące WSZYSTKICH utajnionych encji — niezależne od widza
 *  (etykieta, nie tożsamość: po usunięciu wcześniejszej encji numery się
 *  przesuwają i to jest akceptowane). Cache per referencja stanu. */
const confidentialLabels = createRefCache<AppData, ConfidentialLabels>((state) => ({
  task: buildLabels(state.tasks, (t) => taskIsConfidential(state, t), 'Zadanie'),
  project: buildLabels(state.projects, (p) => p.isConfidential === true, 'Projekt'),
  event: buildLabels(state.events, (e) => e.isConfidential === true, 'Wydarzenie'),
}));

interface ViewerAccess {
  taskIds: Set<string>;
  projectIds: Set<string>;
}

/** Wyjątek wykonawcy: zadania przypisane bieżącemu użytkownikowi + projekty
 *  tych zadań. Klucz cache to referencja stanu — `currentUserId` jest częścią
 *  `AppData`, więc ten sam ref stanu oznacza tego samego widza (kontrakt
 *  selectorCache). `project_members` celowo nie istnieje po stronie klienta. */
const viewerAccess = createRefCache<AppData, ViewerAccess>((state) => {
  const taskIds = new Set<string>();
  const projectIds = new Set<string>();
  if (state.currentUserId === '') return { taskIds, projectIds };
  const byTaskId = new Map(state.tasks.map((t) => [t.id, t]));
  for (const assignment of state.assignments) {
    if (assignment.personId !== state.currentUserId) continue;
    taskIds.add(assignment.taskId);
    const task = byTaskId.get(assignment.taskId);
    if (task) projectIds.add(task.projectId);
  }
  return { taskIds, projectIds };
});

/** Widz ma wgląd w treść zadania: publiczne LUB zarząd LUB przypisany.
 *  Zadanie utajnione WŁASNĄ flagą wymaga przypisania do TEGO zadania;
 *  zadanie dziedziczące maskę z utajnionego PROJEKTU odsłania się każdemu,
 *  kto ma wgląd w projekt (przypisanie do dowolnego jego zadania). */
export function canViewTaskContent(state: AppData, task: Task): boolean {
  if (task.isConfidential === true) {
    return isBoardMember(state) || viewerAccess(state).taskIds.has(task.id);
  }
  const project = state.projects.find((p) => p.id === task.projectId);
  if (project === undefined || project.isConfidential !== true) return true;
  return canViewProjectContent(state, project);
}

/** Widz ma wgląd w treść projektu: publiczny LUB zarząd LUB przypisany do
 *  dowolnego zadania projektu. */
export function canViewProjectContent(state: AppData, project: Project): boolean {
  if (project.isConfidential !== true) return true;
  return isBoardMember(state) || viewerAccess(state).projectIds.has(project.id);
}

/** Widz ma wgląd w treść wydarzenia: publiczne LUB zarząd LUB jawny uczestnik.
 *  Ogólnofirmowe (`attendeeIds: []`) nie daje wyjątku. Urlop nigdy nie niesie
 *  flagi (forma kanoniczna), więc zawsze jest publiczny. */
export function canViewEventContent(state: AppData, event: CalendarEvent): boolean {
  if (event.isConfidential !== true) return true;
  if (isBoardMember(state)) return true;
  return state.currentUserId !== '' && event.attendeeIds.includes(state.currentUserId);
}

/** Maska aktywna = utajnione ORAZ widz bez wglądu. Steruje trybem modali. */
export function isTaskContentMasked(state: AppData, task: Task): boolean {
  return !canViewTaskContent(state, task);
}

export function isProjectContentMasked(state: AppData, project: Project): boolean {
  return !canViewProjectContent(state, project);
}

export function isEventContentMasked(state: AppData, event: CalendarEvent): boolean {
  return !canViewEventContent(state, event);
}

/** Tytuł do wyświetlenia: prawdziwy dla widza z wglądem, „Zadanie #N" dla
 *  pozostałych. Fallback „Zadanie" nie powinien wystąpić (etykieta istnieje dla
 *  każdej utajnionej encji), ale render nigdy nie może dostać pustki. */
export function taskDisplayTitle(state: AppData, task: Task): string {
  if (canViewTaskContent(state, task)) return task.title;
  return confidentialLabels(state).task.get(task.id) ?? 'Zadanie';
}

export function projectDisplayName(state: AppData, project: Project): string {
  if (canViewProjectContent(state, project)) return project.name;
  return confidentialLabels(state).project.get(project.id) ?? 'Projekt';
}

export function eventDisplayTitle(state: AppData, event: CalendarEvent): string {
  if (canViewEventContent(state, event)) return event.title;
  return confidentialLabels(state).event.get(event.id) ?? 'Wydarzenie';
}

/** Etykieta maskująca bez sprawdzania widza — dla miejsc, które już wiedzą, że
 *  maskują (np. nagłówek maskowanego modala). */
export function maskedTaskLabel(state: AppData, taskId: string): string {
  return confidentialLabels(state).task.get(taskId) ?? 'Zadanie';
}

export function maskedProjectLabel(state: AppData, projectId: string): string {
  return confidentialLabels(state).project.get(projectId) ?? 'Projekt';
}

export function maskedEventLabel(state: AppData, eventId: string): string {
  return confidentialLabels(state).event.get(eventId) ?? 'Wydarzenie';
}
