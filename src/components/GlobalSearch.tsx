// Global search palette (Ctrl/Cmd+K, `/`, or the sidebar trigger). Opens an
// overlay that searches projects, tasks, clients and people via the pure
// `searchAll` selector, with a flat keyboard-navigable result list. Rendered
// once at App level; the overlay is fixed-positioned so its DOM location does
// not matter. Selecting a result jumps to the entity and closes the palette.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import {
  getClient,
  getProject,
  getStatus,
  projectsOfClient,
  searchAll,
} from '../store/selectors';
import { StatusBadge } from './StatusBadge';
import { Avatar } from './Avatar';
import { Search, ChevronRight } from './icons';
import { formatShort } from '../utils/dates';
import { polishCount } from '../utils/polish';
import { useOpenTask } from './TaskModal';

type FlatItem =
  | { kind: 'project'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'client'; id: string }
  | { kind: 'person'; id: string };

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

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const navigate = useNavigate();
  const { openTask } = useOpenTask();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchAll(state, query), [state, query]);

  // Flatten all rows once so ↑/↓ index math stays trivial.
  const flat = useMemo<FlatItem[]>(
    () => [
      ...results.projects.map((p) => ({ kind: 'project' as const, id: p.id })),
      ...results.tasks.map((t) => ({ kind: 'task' as const, id: t.id })),
      ...results.clients.map((c) => ({ kind: 'client' as const, id: c.id })),
      ...results.people.map((p) => ({ kind: 'person' as const, id: p.id })),
    ],
    [results],
  );

  // Reset the highlight whenever the result set changes.
  useEffect(() => {
    setActive(0);
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

  const activate = useCallback(
    (item: FlatItem) => {
      onClose();
      switch (item.kind) {
        case 'project':
          navigate(`/projects/${item.id}`);
          break;
        case 'task':
          openTask(item.id);
          break;
        case 'person':
          navigate(`/people/${item.id}`);
          break;
        case 'client':
          navigate(`/projects?client=${item.id}`);
          break;
      }
    },
    [navigate, openTask, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Stop the modal/drawer window-level Escape listeners from also firing.
      e.stopPropagation();
      onClose();
      return;
    }
    if (flat.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[active];
      if (item) activate(item);
    }
  };

  const hasResults = flat.length > 0;

  // Running offset so each group's rows map onto the flat index.
  let idx = 0;
  const rowId = (i: number) => `gs-row-${i}`;

  const renderGroup = (
    label: string,
    render: () => React.ReactNode,
    count: number,
  ) => {
    if (count === 0) return null;
    return (
      <div className="gs-group" role="group" aria-label={label}>
        <div className="gs-group-head">{label}</div>
        {render()}
      </div>
    );
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
              placeholder="Szukaj projektów, zadań, klientów, osób… (także status lub data RRRR-MM-DD)"
              role="combobox"
              aria-expanded={hasResults}
              aria-controls="gs-results"
              aria-activedescendant={hasResults ? rowId(active) : undefined}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="gs-results" id="gs-results" role="listbox">
            {query.trim() === '' ? (
              <p className="gs-hint">
                Zacznij pisać, aby przeszukać projekty, zadania, klientów i zespół.
              </p>
            ) : !hasResults ? (
              <p className="gs-hint">Brak wyników dla „{query.trim()}”.</p>
            ) : (
              <>
                {renderGroup(
                  'Projekty',
                  () => (
                    <>
                      {results.projects.map((p) => {
                        const i = idx++;
                        const client = getClient(state, p.clientId);
                        return (
                          <button
                            type="button"
                            key={p.id}
                            id={rowId(i)}
                            role="option"
                            aria-selected={i === active}
                            className={i === active ? 'gs-row active' : 'gs-row'}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => activate({ kind: 'project', id: p.id })}
                          >
                            <span className="gs-row-main">
                              <span className="gs-row-title">{p.name}</span>
                              <StatusBadge status={getStatus(state, p.statusId)} />
                            </span>
                            <span className="gs-row-meta">
                              {client ? client.name : 'Bez klienta'} ·{' '}
                              {formatShort(p.startDate)} – {formatShort(p.endDate)}
                            </span>
                            <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
                          </button>
                        );
                      })}
                    </>
                  ),
                  results.projects.length,
                )}

                {renderGroup(
                  'Zadania',
                  () => (
                    <>
                      {results.tasks.map((t) => {
                        const i = idx++;
                        const project = getProject(state, t.projectId);
                        return (
                          <button
                            type="button"
                            key={t.id}
                            id={rowId(i)}
                            role="option"
                            aria-selected={i === active}
                            className={i === active ? 'gs-row active' : 'gs-row'}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => activate({ kind: 'task', id: t.id })}
                          >
                            <span className="gs-row-main">
                              <span className="gs-row-title">{t.title}</span>
                              <StatusBadge status={getStatus(state, t.statusId)} />
                            </span>
                            <span className="gs-row-meta">
                              {project ? project.name : 'Bez projektu'} ·{' '}
                              {formatShort(t.startDate)} – {formatShort(t.endDate)}
                            </span>
                            <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
                          </button>
                        );
                      })}
                    </>
                  ),
                  results.tasks.length,
                )}

                {renderGroup(
                  'Klienci',
                  () => (
                    <>
                      {results.clients.map((c) => {
                        const i = idx++;
                        const count = projectsOfClient(state, c.id).length;
                        return (
                          <button
                            type="button"
                            key={c.id}
                            id={rowId(i)}
                            role="option"
                            aria-selected={i === active}
                            className={i === active ? 'gs-row active' : 'gs-row'}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => activate({ kind: 'client', id: c.id })}
                          >
                            <span className="gs-row-main">
                              <span className="gs-row-title">{c.name}</span>
                            </span>
                            <span className="gs-row-meta">
                              {count}{' '}
                              {polishCount(count, 'projekt', 'projekty', 'projektów')}
                            </span>
                            <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
                          </button>
                        );
                      })}
                    </>
                  ),
                  results.clients.length,
                )}

                {renderGroup(
                  'Zespół',
                  () => (
                    <>
                      {results.people.map((p) => {
                        const i = idx++;
                        return (
                          <button
                            type="button"
                            key={p.id}
                            id={rowId(i)}
                            role="option"
                            aria-selected={i === active}
                            className={i === active ? 'gs-row active' : 'gs-row'}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => activate({ kind: 'person', id: p.id })}
                          >
                            <span className="gs-row-main gs-row-person">
                              <Avatar person={p} size={26} />
                              <span className="gs-row-title">{p.name}</span>
                            </span>
                            <span className="gs-row-meta">{p.role || 'Zespół'}</span>
                            <ChevronRight size={16} aria-hidden className="gs-row-chevron" />
                          </button>
                        );
                      })}
                    </>
                  ),
                  results.people.length,
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
