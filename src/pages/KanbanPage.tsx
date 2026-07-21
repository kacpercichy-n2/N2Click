// Kanban: the TASK board. Columns = active statuses in pipeline order, plus a
// trailing "Zarchiwizowane" column for tasks sitting in an archived status;
// dragging a task card into a column dispatches SET_TASK_STATUS. A card opens
// the task in TaskModal (it never navigates to the project). Client and payment
// filters are resolved through the task's project, the person filter through its
// assignees. All filtering/grouping lives in the pure module `kanbanBoard.ts`.
// Admins can quick-create a status by typing "/Status name" in the quick-add box.
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { activeStatuses, getClient } from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { PriorityBadge } from '../components/PriorityBadge';
import { FilterPanel, type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { PersonFilter } from '../components/PersonFilter';
import { useOpenTask } from '../components/TaskModal';
import { buildKanbanColumns, buildTaskAssigneeIds } from './kanbanBoard';
import { type PaidFilter } from './ProjectsPage';
import { formatShortWithWeekday } from '../utils/dates';
import type { Task } from '../types';

// Dark-legible, on-brand rotation for admin quick-created statuses.
const STATUS_COLORS = ['#9aa7c4', '#5bdcff', '#ffc857', '#b9ff4d', '#c496ff', '#ff9640'];

// How many assignee avatars fit on a card before we collapse the rest into "+N".
const MAX_AVATARS = 3;

export function KanbanPage() {
  const { state, dispatch } = useStore();
  const statuses = activeStatuses(state);
  const can = useCan();
  const admin = can('admin.panel');
  const canManage = can('tasks.manage');
  const { openTask } = useOpenTask();

  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all');
  const [clientFilter, setClientFilter] = useState('');
  const [personFilter, setPersonFilter] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null); // statusId
  const [quickStatus, setQuickStatus] = useState('');

  const board = useMemo(
    () =>
      buildKanbanColumns(state, {
        paid: paidFilter,
        clientId: clientFilter,
        personIds: personFilter,
      }),
    [state, paidFilter, clientFilter, personFilter],
  );

  // Cheap per-card lookups: no card scans projects/clients/assignments itself.
  const lookups = useMemo(
    () => ({
      projects: new Map(state.projects.map((p) => [p.id, p])),
      clients: new Map(state.clients.map((c) => [c.id, c])),
      people: new Map(state.people.map((p) => [p.id, p])),
      assignees: buildTaskAssigneeIds(state),
    }),
    [state],
  );

  const paidLabel = (v: PaidFilter) =>
    v === 'paid' ? 'Opłacone' : v === 'unpaid' ? 'Nieopłacone' : 'Wszystkie';

  const filterGroups: FilterGroup[] = [
    {
      key: 'paid',
      label: 'Płatność',
      value: paidFilter,
      onChange: (v) => setPaidFilter(v as PaidFilter),
      options: [
        { value: 'all', label: 'Wszystkie' },
        { value: 'paid', label: 'Opłacone' },
        { value: 'unpaid', label: 'Nieopłacone' },
      ],
    },
    {
      key: 'client',
      label: 'Klient',
      value: clientFilter,
      onChange: setClientFilter,
      options: [
        { value: '', label: 'Wszyscy klienci' },
        ...state.clients.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
  ];

  const activeCount =
    (paidFilter !== 'all' ? 1 : 0) + (clientFilter ? 1 : 0) + (personFilter.size > 0 ? 1 : 0);

  const chips: FilterChip[] = [];
  if (paidFilter !== 'all')
    chips.push({ key: 'paid', label: `Płatność: ${paidLabel(paidFilter)}`, onRemove: () => setPaidFilter('all') });
  if (clientFilter)
    chips.push({
      key: 'client',
      label: `Klient: ${getClient(state, clientFilter)?.name ?? '—'}`,
      onRemove: () => setClientFilter(''),
    });
  if (personFilter.size > 0)
    chips.push({
      key: 'person',
      label: `Osoby: ${[...personFilter]
        .map((id) => lookups.people.get(id)?.name ?? '—')
        .join(', ')}`,
      onRemove: () => setPersonFilter(new Set()),
    });

  const clearAll = () => {
    setPaidFilter('all');
    setClientFilter('');
    setPersonFilter(new Set());
  };

  const togglePerson = (personId: string) =>
    setPersonFilter((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });

  const onDrop = (statusId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    if (!canManage) return;
    const taskId = e.dataTransfer.getData('text/n2hub-task');
    if (taskId) dispatch({ type: 'SET_TASK_STATUS', taskId, statusId });
  };

  const renderCard = (t: Task) => {
    const project = lookups.projects.get(t.projectId);
    const client = project ? lookups.clients.get(project.clientId) : undefined;
    const assigneeIds = lookups.assignees.get(t.id) ?? [];
    const shown = assigneeIds.slice(0, MAX_AVATARS);
    const overflow = assigneeIds.length - shown.length;
    return (
      <motion.div
        key={t.id}
        layout
        whileHover={{ y: -2 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="kanban-card"
        draggable={canManage}
        // onDragStartCapture (not motion's gesture onDragStart) keeps
        // native HTML5 drag-and-drop working on the animated card.
        onDragStartCapture={
          canManage
            ? (e) => {
                e.dataTransfer.setData('text/n2hub-task', t.id);
                e.dataTransfer.effectAllowed = 'move';
              }
            : undefined
        }
        onClick={() => openTask(t.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') openTask(t.id);
        }}
      >
        <div className="kanban-card-top">
          <span className="kanban-card-title">{t.title}</span>
        </div>
        <div className="kanban-card-client">
          {project?.name ?? 'Bez projektu'}
          {client ? ` · ${client.name}` : ''}
        </div>
        <div className="kanban-card-badges">
          <PriorityBadge priority={t.priority} />
          <span className="kanban-card-meta">{formatShortWithWeekday(t.endDate)}</span>
        </div>
        {assigneeIds.length > 0 && (
          <div className="kanban-card-people">
            {shown.map((id) => {
              const person = lookups.people.get(id);
              return person ? <Avatar key={id} person={person} size={22} /> : null;
            })}
            {overflow > 0 && <span className="kanban-card-more">+{overflow}</span>}
          </div>
        )}
      </motion.div>
    );
  };

  const quickCreate = (e: React.FormEvent) => {
    e.preventDefault();
    // "/Name here" quick-create command; a bare name works too.
    const name = quickStatus.replace(/^\//, '').trim();
    if (!name) return;
    dispatch({
      type: 'SAVE_STATUS',
      statusId: null,
      name,
      color: STATUS_COLORS[statuses.length % STATUS_COLORS.length],
    });
    setQuickStatus('');
  };

  return (
    <section className="page page-wide">
      <div className="page-head">
        <h1>Kanban</h1>
        <div className="cal-toolbar">
          <PersonFilter
            people={state.people}
            selected={personFilter}
            onToggle={togglePerson}
            onAll={() => setPersonFilter(new Set())}
          />
          <FilterPanel
            groups={filterGroups}
            activeCount={activeCount}
            onClearAll={clearAll}
            chips={chips}
          />
        </div>
      </div>

      {statuses.length === 0 && board.archived.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak statusów</p>
          <p className="empty-hint">Administrator może utworzyć statusy lejka w panelu Ustawienia.</p>
        </div>
      ) : (
        <div className="kanban-board" data-tour="kanban.board">
          {board.columns.map(({ status: s, tasks }) => (
            <div
              key={s.id}
              data-tour="kanban.column"
              className={dragOver === s.id ? 'kanban-col drag-over' : 'kanban-col'}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(s.id);
              }}
              onDragLeave={() => setDragOver((v) => (v === s.id ? null : v))}
              onDrop={(e) => onDrop(s.id, e)}
            >
              <div className="kanban-col-head" style={{ borderTopColor: s.color }}>
                <span className="kanban-col-name" style={{ color: s.color }}>
                  {s.name}
                </span>
                <span className="kanban-col-count">{tasks.length}</span>
              </div>
              <div className="kanban-col-body">
                {tasks.length === 0 && <div className="kanban-empty">Upuść tutaj</div>}
                {tasks.map((t) => renderCard(t))}
              </div>
            </div>
          ))}

          {board.archived.length > 0 && (
            <div
              className="kanban-col archived-col"
              title="Zadania w zarchiwizowanych statusach — przeciągnij kartę do aktywnej kolumny, aby przywrócić."
            >
              <div className="kanban-col-head">
                <span className="kanban-col-name">Zarchiwizowane</span>
                <span className="kanban-col-count">{board.archived.length}</span>
              </div>
              <div className="kanban-col-body">{board.archived.map((t) => renderCard(t))}</div>
            </div>
          )}

          {admin && (
            <form className="kanban-add-col" onSubmit={quickCreate}>
              <input
                value={quickStatus}
                onChange={(e) => setQuickStatus(e.target.value)}
                placeholder="/Nazwa nowego statusu"
                aria-label="Szybkie dodanie statusu"
                title='Wpisz "/Nazwa statusu" i naciśnij Enter (tylko admin)'
              />
              <button type="submit" className="btn soft" disabled={!quickStatus.trim()}>
                Dodaj
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
