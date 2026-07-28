// Global search palette (Ctrl/Cmd+K, `/`, or the sidebar trigger). Opens an
// overlay that searches projects, tasks, clients and people via the pure
// `searchAll` selector, with a flat keyboard-navigable result list. Rendered
// once at App level; the overlay is fixed-positioned so its DOM location does
// not matter. Selecting a result jumps to the entity and closes the palette.
//
// Rozszerzenia palety (PKG-global-search-palette):
// - JEDNA płaska lista wierszy budowana z grup (`buildGroups`), więc szybkie
//   akcje, „ostatnio otwarte”, wyniki i wiersz „Pokaż więcej” mają wspólną
//   arytmetykę indeksów, wspólne `role="option"` i wspólne `aria-activedescendant`.
// - Limit per grupa jest PRZEKAZYWANY do `searchAll` (skan przerywa się po
//   przekroczeniu limitu), a rozwinięcie grupy podnosi limit tylko dla niej.
// - Klawiatura przewija aktywny wiersz (`scrollIntoView({ block: 'nearest' })`);
//   mysz przejmuje zaznaczenie DOPIERO po realnym ruchu kursora.
// - Czysta logika (akcje, podświetlanie, komunikat, ostatnio otwarte) mieszka w
//   `globalSearchModel.ts` i jest testowana w node.
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import {
  DEFAULT_SEARCH_LIMIT,
  buildSearchResultMeta,
  currentUser as currentUserSelector,
  searchAll,
} from '../store/selectors';
import type { SearchGroupKey, SearchLimits, SearchResultMeta } from '../store/selectors';
import { can } from '../store/permissions';
import { canViewTeam } from '../pages/teamScope';
import type { Client, Person, Project, Task } from '../types';
import { StatusBadge } from './StatusBadge';
import { Avatar } from './Avatar';
import { Search, ChevronRight, Plus } from './icons';
import type { LucideIcon } from './icons';
import { NAV_ITEMS } from './navItems';
import {
  filterQuickActions,
  highlightSegments,
  inlineQuickActions,
  isQuickActionQuery,
  quickActionCatalog,
  quickActionTerm,
  recentPaletteRefs,
  rememberOpenedRef,
  resultsAnnouncement,
} from './globalSearchModel';
import type { QuickAction } from './globalSearchModel';
import { formatShortWithWeekday } from '../utils/dates';
import { polishCount } from '../utils/polishPlural';
import { announce } from '../utils/liveRegion';
import { useOpenTask } from './TaskModal';

/** Ile wierszy pokazuje rozwinięta grupa (drugi i ostatni krok — bez paginacji). */
const EXPANDED_SEARCH_LIMIT = 40;

const NAV_ICON_BY_PATH = new Map<string, LucideIcon>(
  NAV_ITEMS.map(([path, , icon]) => [path, icon]),
);

type Row =
  | { key: string; kind: 'action'; action: QuickAction }
  | { key: string; kind: 'project'; project: Project }
  | { key: string; kind: 'task'; task: Task }
  | { key: string; kind: 'client'; client: Client }
  | { key: string; kind: 'person'; person: Person }
  | { key: string; kind: 'more'; group: SearchGroupKey; label: string };

interface RowGroup {
  key: string;
  label: string;
  rows: Row[];
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

/** App-level single mount: renders the sidebar trigger + the overlay palette. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [searchParams] = useSearchParams();
  // The task popout modal (z 1001) renders above the palette (z 991). While it
  // is open (URL-param driven), suppress the palette entirely so the hidden
  // overlay can't steal focus or let Enter navigate past the modal's dirty guard.
  const taskModalOpen = searchParams.get('task') !== null;

  // Close the palette if a task modal opens over it.
  useEffect(() => {
    if (taskModalOpen) setOpen(false);
  }, [taskModalOpen]);

  // Global hotkeys: Ctrl/Cmd+K toggles; `/` opens when not typing in a field.
  useEffect(() => {
    if (taskModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !open &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, taskModalOpen]);

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        data-tour="shell.search"
        onClick={() => setOpen(true)}
        aria-label="Szukaj"
      >
        <Search size={16} aria-hidden className="search-trigger-icon" />
        <span className="search-trigger-label">Szukaj…</span>
        <kbd className="search-trigger-kbd">Ctrl K</kbd>
      </button>
      <AnimatePresence>
        {open && <SearchOverlay key="global-search" onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

/** Podświetlenie dopasowania w tytule/podtytule (rozłączne fragmenty z modelu). */
function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => highlightSegments(text, query), [text, query]);
  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="gs-mark">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const navigate = useNavigate();
  const { openTask, openNewTask } = useOpenTask();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Grupy rozwinięte przyciskiem „Pokaż więcej” (reset przy zmianie frazy).
  const [expanded, setExpanded] = useState<readonly SearchGroupKey[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Klawiatura przewija aktywny wiersz; mysz i pierwsze renderowanie nie.
  const scrollActiveRef = useRef(false);
  // Mysz przejmuje zaznaczenie DOPIERO po realnym ruchu kursora: samo wjechanie
  // listy pod nieruchomy kursor (przewijanie strzałkami) nie może go ukraść.
  const mouseMovedRef = useRef(false);

  // Defer the query so each keystroke stays responsive: the input updates
  // immediately while the (potentially large) `searchAll` scan runs against the
  // deferred value. The FINAL results are identical to running it synchronously.
  const deferredQuery = useDeferredValue(query);
  const quickMode = isQuickActionQuery(deferredQuery);
  const searchQuery = quickMode ? '' : deferredQuery;

  // Limit per grupa JEST przekazywany do selektora: skan przerywa się zaraz po
  // przekroczeniu limitu, więc pojedyncza litera nie przemiata całej kolekcji.
  const limits = useMemo<SearchLimits>(
    () => ({
      projects: expanded.includes('projects') ? EXPANDED_SEARCH_LIMIT : DEFAULT_SEARCH_LIMIT,
      tasks: expanded.includes('tasks') ? EXPANDED_SEARCH_LIMIT : DEFAULT_SEARCH_LIMIT,
      clients: expanded.includes('clients') ? EXPANDED_SEARCH_LIMIT : DEFAULT_SEARCH_LIMIT,
      people: expanded.includes('people') ? EXPANDED_SEARCH_LIMIT : DEFAULT_SEARCH_LIMIT,
    }),
    [expanded],
  );
  const results = useMemo(
    () => searchAll(state, searchQuery, limits),
    [state, searchQuery, limits],
  );

  // Row-label metadata built once per state revision (not per result, per render
  // or per active-row change): client/project/status lookup maps + client project
  // counts. Identical output to the former per-result selector calls.
  const meta = useMemo(() => buildSearchResultMeta(state), [state]);

  // Szybkie akcje: WYŁĄCZNIE to, co aplikacja już potrafi (nowe zadanie +
  // nawigacja). Bramki `/admin` i `/team` lustrzane do menu — UX, nie ochrona.
  const me = currentUserSelector(state);
  const catalog = useMemo(
    () =>
      quickActionCatalog({
        canAdmin: can(me, 'admin.panel', { peopleCount: state.people.length }),
        canTeam: canViewTeam(me),
      }),
    [me, state.people.length],
  );

  const trimmed = deferredQuery.trim();
  const highlightQuery = quickMode ? quickActionTerm(deferredQuery) : trimmed;

  // Płaska lista grup — jedno źródło dla renderu, indeksów i ogłoszenia.
  const groups = useMemo<RowGroup[]>(() => {
    const actions = quickMode
      ? filterQuickActions(quickActionTerm(deferredQuery), catalog, Number.POSITIVE_INFINITY)
      : inlineQuickActions(trimmed, catalog);
    const out: RowGroup[] = [];
    if (actions.length > 0) {
      out.push({
        key: 'actions',
        label: 'Szybkie akcje',
        rows: actions.map((action) => ({ key: `action:${action.id}`, kind: 'action', action })),
      });
    }
    if (quickMode) return out;

    if (trimmed === '') {
      // Pusta fraza: „ostatnio otwarte” z pamięci sesji palety + dziennika
      // aktywności (żadnej nowej trwałości — obie rzeczy już istnieją).
      const recent = recentPaletteRefs(state);
      const rows: Row[] = [];
      for (const ref of recent) {
        if (ref.kind === 'project') {
          const project = meta.projectsById.get(ref.id);
          if (project) rows.push({ key: `recent:project:${ref.id}`, kind: 'project', project });
        } else {
          const task = state.tasks.find((t) => t.id === ref.id);
          if (task) rows.push({ key: `recent:task:${ref.id}`, kind: 'task', task });
        }
      }
      if (rows.length > 0) out.push({ key: 'recent', label: 'Ostatnio otwarte', rows });
      return out;
    }

    const withMore = (group: SearchGroupKey, rows: Row[]): Row[] =>
      results.hasMore[group]
        ? [...rows, { key: `more:${group}`, kind: 'more' as const, group, label: 'Pokaż więcej' }]
        : rows;

    if (results.projects.length > 0) {
      out.push({
        key: 'projects',
        label: 'Projekty',
        rows: withMore(
          'projects',
          results.projects.map((project) => ({
            key: `project:${project.id}`,
            kind: 'project' as const,
            project,
          })),
        ),
      });
    }
    if (results.tasks.length > 0) {
      out.push({
        key: 'tasks',
        label: 'Zadania',
        rows: withMore(
          'tasks',
          results.tasks.map((task) => ({ key: `task:${task.id}`, kind: 'task' as const, task })),
        ),
      });
    }
    if (results.clients.length > 0) {
      out.push({
        key: 'clients',
        label: 'Klienci',
        rows: withMore(
          'clients',
          results.clients.map((client) => ({
            key: `client:${client.id}`,
            kind: 'client' as const,
            client,
          })),
        ),
      });
    }
    if (results.people.length > 0) {
      out.push({
        key: 'people',
        label: 'Zespół',
        rows: withMore(
          'people',
          results.people.map((person) => ({
            key: `person:${person.id}`,
            kind: 'person' as const,
            person,
          })),
        ),
      });
    }
    return out;
  }, [catalog, deferredQuery, meta, quickMode, results, state, trimmed]);

  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const indexByKey = useMemo(
    () => new Map(rows.map((row, i) => [row.key, i])),
    [rows],
  );
  const hasRows = rows.length > 0;
  // Wyniki potrafią się skurczyć (nowa fraza, świeży stan) — trzymaj indeks w zakresie.
  const activeIndex = hasRows ? Math.min(active, rows.length - 1) : -1;

  // Reset the highlight whenever the result set changes.
  useEffect(() => {
    setActive(0);
    setExpanded([]);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);

  // Autofocus the input + lock body scroll while the palette is open.
  useEffect(() => {
    inputRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Pierwszy realny ruch myszy odblokowuje `onMouseEnter`.
  useEffect(() => {
    const onMove = () => {
      mouseMovedRef.current = true;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Nawigacja klawiaturą trzyma aktywny wiersz w widoku (i tylko ona).
  useEffect(() => {
    if (!scrollActiveRef.current) return;
    scrollActiveRef.current = false;
    if (activeIndex < 0) return;
    const el = document.getElementById(rowId(activeIndex));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Liczba wyników dla czytnika ekranu („12 wyników w 3 grupach”). Wiersz
  // „Pokaż więcej” nie jest wynikiem, więc nie wchodzi do liczenia.
  useEffect(() => {
    if (trimmed === '') return;
    announce({
      id: 'global-search',
      text: resultsAnnouncement(
        groups.map((g) => g.rows.filter((r) => r.kind !== 'more').length),
      ),
      tone: 'polite',
    });
  }, [groups, trimmed]);

  const runAction = useCallback(
    (action: QuickAction) => {
      if (action.run.kind === 'new-task') openNewTask();
      else navigate(action.run.path);
    },
    [navigate, openNewTask],
  );

  const activateRow = useCallback(
    (row: Row) => {
      if (row.kind === 'more') {
        // Rozwinięcie grupy zostawia paletę otwartą (aktywny indeks zostaje na
        // pierwszym doładowanym wierszu, który wchodzi w miejsce tego przycisku).
        setExpanded((prev) => (prev.includes(row.group) ? prev : [...prev, row.group]));
        return;
      }
      onClose();
      switch (row.kind) {
        case 'action':
          runAction(row.action);
          break;
        case 'project':
          rememberOpenedRef({ kind: 'project', id: row.project.id });
          navigate(`/projects/${row.project.id}`);
          break;
        case 'task':
          rememberOpenedRef({ kind: 'task', id: row.task.id });
          openTask(row.task.id);
          break;
        case 'person':
          navigate(`/people/${row.person.id}`);
          break;
        case 'client':
          navigate(`/projects?client=${row.client.id}`);
          break;
      }
    },
    [navigate, openTask, onClose, runAction],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Stop the modal/drawer window-level Escape listeners from also firing.
      e.stopPropagation();
      onClose();
      return;
    }
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mouseMovedRef.current = false;
      scrollActiveRef.current = true;
      setActive((i) => (Math.min(i, rows.length - 1) + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mouseMovedRef.current = false;
      scrollActiveRef.current = true;
      setActive((i) => (Math.min(i, rows.length - 1) - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) activateRow(row);
    }
  };

  const onRowHover = (i: number) => {
    if (mouseMovedRef.current) setActive(i);
  };

  const rowProps = (row: Row) => {
    const i = indexByKey.get(row.key) ?? 0;
    return {
      type: 'button' as const,
      id: rowId(i),
      role: 'option',
      'aria-selected': i === activeIndex,
      className: i === activeIndex ? 'gs-row active' : 'gs-row',
      onMouseEnter: () => onRowHover(i),
      onClick: () => activateRow(row),
    };
  };

  return (
    <>
      <motion.div
        className="gs-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
      />
      <div className="gs-viewport" onClick={onClose}>
        <motion.div
          className="gs-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Wyszukiwarka"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="gs-input-row">
            <Search size={18} aria-hidden className="gs-input-icon" />
            <input
              ref={inputRef}
              className="gs-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Szukaj projektów, zadań, klientów, osób… („>” = szybkie akcje)"
              role="combobox"
              aria-expanded={hasRows}
              aria-controls="gs-results"
              aria-activedescendant={activeIndex >= 0 ? rowId(activeIndex) : undefined}
              // Wolne wyszukiwanie z listą podpowiedzi, NIE zamknięta lista
              // wyboru: wpisany tekst zostaje tekstem, wiersze tylko podpowiadają.
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="gs-results" id="gs-results" role="listbox" ref={listRef}>
            {!hasRows ? (
              <p className="gs-hint">
                {trimmed === ''
                  ? 'Zacznij pisać, aby przeszukać projekty, zadania, klientów i zespół.'
                  : `Brak wyników dla „${trimmed}”.`}
              </p>
            ) : (
              groups.map((group) => (
                <div className="gs-group" role="group" aria-label={group.label} key={group.key}>
                  <div className="gs-group-head">{group.label}</div>
                  {group.rows.map((row) => (
                    <RowButton
                      key={row.key}
                      row={row}
                      props={rowProps(row)}
                      meta={meta}
                      query={highlightQuery}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}

const rowId = (i: number) => `gs-row-${i}`;

/** Wspólne atrybuty opcji listbox — liczone raz w `rowProps`, jeden render na wiersz. */
interface RowButtonProps {
  type: 'button';
  id: string;
  role: string;
  'aria-selected': boolean;
  className: string;
  onMouseEnter: () => void;
  onClick: () => void;
}

function RowButton({
  row,
  props,
  meta,
  query,
}: {
  row: Row;
  props: RowButtonProps;
  meta: SearchResultMeta;
  query: string;
}) {
  switch (row.kind) {
    case 'action': {
      const Icon =
        row.action.run.kind === 'new-task'
          ? Plus
          : (NAV_ICON_BY_PATH.get(row.action.run.path) ?? ChevronRight);
      return (
        <button {...props}>
          <span className="gs-row-main">
            <Icon size={16} aria-hidden className="gs-row-icon" />
            <span className="gs-row-title">
              <Highlight text={row.action.label} query={query} />
            </span>
          </span>
          <span className="gs-row-meta">{row.action.hint}</span>
          <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
        </button>
      );
    }
    case 'project': {
      const client = meta.clientsById.get(row.project.clientId);
      return (
        <button {...props}>
          <span className="gs-row-main">
            <span className="gs-row-title">
              <Highlight text={row.project.name} query={query} />
            </span>
            <StatusBadge status={meta.statusesById.get(row.project.statusId)} />
          </span>
          <span className="gs-row-meta">
            {client ? <Highlight text={client.name} query={query} /> : 'Bez klienta'} ·{' '}
            {formatShortWithWeekday(row.project.startDate)} –{' '}
            {formatShortWithWeekday(row.project.endDate)}
          </span>
          <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
        </button>
      );
    }
    case 'task': {
      const project = meta.projectsById.get(row.task.projectId);
      return (
        <button {...props}>
          <span className="gs-row-main">
            <span className="gs-row-title">
              <Highlight text={row.task.title} query={query} />
            </span>
            <StatusBadge status={meta.statusesById.get(row.task.statusId)} />
          </span>
          <span className="gs-row-meta">
            {project ? <Highlight text={project.name} query={query} /> : 'Bez projektu'} ·{' '}
            {formatShortWithWeekday(row.task.startDate)} –{' '}
            {formatShortWithWeekday(row.task.endDate)}
          </span>
          <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
        </button>
      );
    }
    case 'client': {
      const count = meta.clientProjectCounts.get(row.client.id) ?? 0;
      return (
        <button {...props}>
          <span className="gs-row-main">
            <span className="gs-row-title">
              <Highlight text={row.client.name} query={query} />
            </span>
          </span>
          <span className="gs-row-meta">
            {count} {polishCount(count, 'projekt', 'projekty', 'projektów')}
          </span>
          <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
        </button>
      );
    }
    case 'person':
      return (
        <button {...props}>
          <span className="gs-row-main gs-row-person">
            <Avatar person={row.person} size={26} />
            <span className="gs-row-title">
              <Highlight text={row.person.name} query={query} />
            </span>
          </span>
          <span className="gs-row-meta">
            {row.person.role ? <Highlight text={row.person.role} query={query} /> : 'Zespół'}
          </span>
          <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
        </button>
      );
    case 'more':
      return (
        <button {...props} className={`${props.className} gs-row-more`}>
          <span className="gs-row-main">
            <Plus size={16} aria-hidden className="gs-row-icon" />
            <span className="gs-row-title">{row.label}</span>
          </span>
        </button>
      );
  }
}
