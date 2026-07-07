// Kanban: the PROJECT pipeline board. Columns = active statuses in pipeline
// order; dragging a project card into a column changes its status. Admins can
// quick-create a status by typing "/Status name" in the quick-add box.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import {
  activeStatuses,
  getClient,
  isAdminUser,
  peopleIdsOfProject,
  projectPlannedTotal,
  tasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { PaidFilterToggle, type PaidFilter } from './ProjectsPage';
import { formatShort } from '../utils/dates';

// Dark-legible, on-brand rotation for admin quick-created statuses.
const STATUS_COLORS = ['#9aa7c4', '#5bdcff', '#ffc857', '#b9ff4d', '#c496ff', '#ff9640'];

function polishCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

export function KanbanPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const statuses = activeStatuses(state);
  const admin = isAdminUser(state);

  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all');
  const [clientFilter, setClientFilter] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null); // statusId
  const [quickStatus, setQuickStatus] = useState('');

  const projects = useMemo(
    () =>
      state.projects.filter(
        (p) =>
          (paidFilter === 'all' || p.paid === (paidFilter === 'paid')) &&
          (!clientFilter || p.clientId === clientFilter),
      ),
    [state.projects, paidFilter, clientFilter],
  );

  const onDrop = (statusId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const projectId = e.dataTransfer.getData('text/n2ub-project');
    if (projectId) dispatch({ type: 'SET_PROJECT_STATUS', projectId, statusId });
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
          <PaidFilterToggle value={paidFilter} onChange={setPaidFilter} />
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filtruj po kliencie"
          >
            <option value="">Wszyscy klienci</option>
            {state.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {statuses.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak statusów</p>
          <p className="empty-hint">Administrator może utworzyć statusy lejka w panelu Administracja.</p>
        </div>
      ) : (
        <div className="kanban-board">
          {statuses.map((s) => {
            const cards = projects.filter((p) => p.statusId === s.id);
            return (
              <div
                key={s.id}
                className={
                  dragOver === s.id ? 'kanban-col drag-over' : 'kanban-col'
                }
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
                  <span className="kanban-col-count">{cards.length}</span>
                </div>
                <div className="kanban-col-body">
                  {cards.length === 0 && <div className="kanban-empty">Upuść tutaj</div>}
                  {cards.map((p) => {
                    const client = getClient(state, p.clientId);
                    const taskCount = tasksOfProject(state, p.id).length;
                    const planned = projectPlannedTotal(state, p.id);
                    const team = peopleIdsOfProject(state, p.id).length;
                    return (
                      <motion.div
                        key={p.id}
                        layout
                        whileHover={{ y: -2 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="kanban-card"
                        draggable
                        // onDragStartCapture (not motion's gesture onDragStart) keeps
                        // native HTML5 drag-and-drop working on the animated card.
                        onDragStartCapture={(e) => {
                          e.dataTransfer.setData('text/n2ub-project', p.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => navigate(`/projects/${p.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') navigate(`/projects/${p.id}`);
                        }}
                      >
                        <div className="kanban-card-top">
                          <span className="kanban-card-title">{p.name}</span>
                          <Coin paid={p.paid} size={16} />
                        </div>
                        {client && <div className="kanban-card-client">{client.name}</div>}
                        <div className="kanban-card-meta">
                          {formatShort(p.startDate)} – {formatShort(p.endDate)}
                        </div>
                        <div className="kanban-card-meta muted">
                          {taskCount} {polishCount(taskCount, 'zadanie', 'zadania', 'zadań')} ·{' '}
                          {planned}h · {team} {polishCount(team, 'osoba', 'osoby', 'osób')}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            );
          })}

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
