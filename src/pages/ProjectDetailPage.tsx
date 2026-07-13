// Project detail card: editable fields (client, status, paid coin, dates,
// department, service type, description), milestones, the project's tasks, and
// the chat/comments + activity section.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore, usePersistence } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { NO_PERM_TITLE } from '../store/permissions';
import type { ProjectDraft } from '../store/AppStore';
import {
  activeStatuses,
  assigneesOfTask,
  getStatus,
  milestonesOfProject,
  projectPlannedTotal,
  taskPlannedTotal,
  taskPlanningStatus,
  tasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { PlanningBadge } from '../components/PlanningBadge';
import { PersonChip } from '../components/PersonChip';
import { CommentsPanel } from '../components/CommentsPanel';
import { SaveStatus } from '../components/SaveStatus';
import { useOpenTask } from '../components/TaskModal';
import { ChevronRight } from '../components/icons';
import { formatShort, todayStr, isValidDateStr, periodError, PERIOD_ERROR_LABELS } from '../utils/dates';
import { formatDuration } from '../utils/time';
import { useSaveStatus } from '../utils/useSaveStatus';

export function ProjectDetailPage() {
  const { id } = useParams();
  const { state } = useStore();
  const project = state.projects.find((p) => p.id === id);

  if (!project) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Nie znaleziono projektu</p>
          <Link to="/projects" className="btn primary">
            Wróć do projektów
          </Link>
        </div>
      </section>
    );
  }
  // Key by project id so the editable draft resets when switching projects.
  return <ProjectDetail key={project.id} projectId={project.id} />;
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { openTask, openNewTask } = useOpenTask();
  const { state, dispatch } = useStore();
  const can = useCan();
  const canManage = can('projects.manage');
  const canPaid = can('projects.paid');
  const canManageTasks = can('tasks.manage');
  const disabledTitle = canManage ? undefined : NO_PERM_TITLE;
  const project = state.projects.find((p) => p.id === projectId);

  // ---- Editable draft (component remounts per project id) ----
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [clientId, setClientId] = useState(project?.clientId ?? '');
  const [statusId, setStatusId] = useState(project?.statusId ?? '');
  const [startDate, setStartDate] = useState(project?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(project?.endDate ?? todayStr());
  const [departmentId, setDepartmentId] = useState(project?.departmentId ?? '');
  const [serviceTypeId, setServiceTypeId] = useState(project?.serviceTypeId ?? '');
  const [error, setError] = useState('');

  // ---- Milestone form ----
  const [msName, setMsName] = useState('');
  const [msDate, setMsDate] = useState(todayStr());
  const [msError, setMsError] = useState('');

  const dirty = project
    ? name !== project.name ||
      description !== project.description ||
      clientId !== project.clientId ||
      statusId !== project.statusId ||
      startDate !== project.startDate ||
      endDate !== project.endDate ||
      departmentId !== project.departmentId ||
      serviceTypeId !== project.serviceTypeId
    : false;
  const { saveError } = usePersistence();
  const { status, markSaved } = useSaveStatus(dirty, saveError !== null);

  // Deleted mid-render (e.g. right after the delete dispatch, before the route
  // change lands): render nothing for that frame.
  if (!project) return null;

  const tasks = tasksOfProject(state, project.id).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const milestones = milestonesOfProject(state, project.id);
  const statuses = activeStatuses(state);
  const currentStatus = getStatus(state, project.statusId);
  // Archived current status must remain pickable so the select isn't lying.
  const pickableStatuses =
    currentStatus && currentStatus.archived ? [...statuses, currentStatus] : statuses;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nazwa projektu jest wymagana');
      return;
    }
    const perErr = periodError(startDate, endDate);
    if (perErr) {
      setError(PERIOD_ERROR_LABELS[perErr]);
      return;
    }
    const trimmedDescription = description.trim();
    const draft: ProjectDraft = {
      clientId,
      name: trimmed,
      description: trimmedDescription,
      statusId,
      paid: project.paid,
      startDate,
      endDate,
      departmentId,
      serviceTypeId,
    };
    dispatch({ type: 'SAVE_PROJECT', projectId: project.id, draft });
    // Normalize local state to exactly what was persisted so `dirty` clears
    // (otherwise untrimmed whitespace keeps the form permanently dirty).
    setName(trimmed);
    setDescription(trimmedDescription);
    setError('');
    markSaved();
  };

  const togglePaid = () =>
    dispatch({ type: 'SET_PROJECT_PAID', projectId: project.id, paid: !project.paid });

  const remove = () => {
    if (
      window.confirm(
        `Usunąć projekt „${project.name}”? To usunie ${tasks.length} zadań, przypisania, zaplanowane godziny, kamienie milowe i komentarze.`,
      )
    ) {
      dispatch({ type: 'DELETE_PROJECT', projectId: project.id });
      navigate('/projects');
    }
  };

  const addMilestone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msName.trim()) return;
    if (!isValidDateStr(msDate)) {
      setMsError('Podaj prawidłową datę kamienia milowego.');
      return;
    }
    dispatch({
      type: 'SAVE_MILESTONE',
      milestoneId: null,
      projectId: project.id,
      name: msName,
      date: msDate,
    });
    setMsName('');
    setMsError('');
  };

  return (
    <section className="page editor">
      <div className="page-head">
        <h1 className="project-detail-title">
          <Coin paid={project.paid} size={24} onToggle={canPaid ? togglePaid : undefined} />
          {project.name}
          <StatusBadge status={currentStatus} />
        </h1>
        <div className="page-head-actions">
          <SaveStatus status={status} />
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (
                dirty &&
                !window.confirm('Masz niezapisane zmiany. Opuścić bez zapisywania?')
              ) {
                return;
              }
              navigate('/projects');
            }}
          >
            Wróć
          </button>
          {canManage && (
            <button type="button" className="btn danger-ghost" onClick={remove}>
              Usuń projekt
            </button>
          )}
        </div>
      </div>

      <div className="editor-section">
        <h2>Szczegóły</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pd-name">Nazwa *</label>
            <input
              id="pd-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            />
          </div>
          <div className="field">
            <label htmlFor="pd-client">Klient</label>
            <select
              id="pd-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              {state.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pd-status">Status</label>
            <select
              id="pd-status"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              {pickableStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.archived ? ' (zarchiwizowany)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pd-start">Data startu</label>
            <input
              id="pd-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            />
          </div>
          <div className="field">
            <label htmlFor="pd-end">Data końca</label>
            <input
              id="pd-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            />
          </div>
          <div className="field">
            <label htmlFor="pd-dep">Dział</label>
            <select
              id="pd-dep"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              <option value="">—</option>
              {state.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pd-svc">Typ usługi</label>
            <select
              id="pd-svc"
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              <option value="">—</option>
              {state.serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pd-desc">Opis</label>
          <textarea
            id="pd-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canManage}
            title={disabledTitle}
          />
        </div>
        <div className="field-row payment-row">
          <span className="field-hint">
            Płatność: <Coin paid={project.paid} onToggle={canPaid ? togglePaid : undefined} />{' '}
            <strong>{project.paid ? 'opłacony' : 'nieopłacony'}</strong>
            {canPaid && ' (kliknij monetę, aby przełączyć)'}
          </span>
        </div>
        {error && <p className="field-error">{error}</p>}
        {(dirty || status !== 'clean') && (
          <div className="editor-actions">
            <button type="button" className="btn primary" onClick={save} disabled={!dirty}>
              Zapisz zmiany
            </button>
          </div>
        )}
      </div>

      <div className="editor-section">
        <h2>Kamienie milowe</h2>
        {milestones.length === 0 ? (
          <p className="field-hint">Brak kamieni milowych.</p>
        ) : (
          <ul className="milestone-list">
            {milestones.map((m) => (
              <li key={m.id} className="milestone-row">
                <span className="milestone-diamond" aria-hidden>
                  ◆
                </span>
                <span className="milestone-name">{m.name}</span>
                <input
                  type="date"
                  value={m.date}
                  onChange={(e) => {
                    // Ignore invalid/cleared dates — the controlled input snaps
                    // back to the stored value, so the milestone keeps its date.
                    if (!isValidDateStr(e.target.value)) return;
                    dispatch({
                      type: 'MOVE_MILESTONE',
                      milestoneId: m.id,
                      date: e.target.value,
                    });
                  }}
                  aria-label={`Data dla ${m.name}`}
                  disabled={!canManage}
                  title={disabledTitle}
                />
                {canManage && (
                  <button
                    type="button"
                    className="btn danger-ghost"
                    onClick={() => dispatch({ type: 'DELETE_MILESTONE', milestoneId: m.id })}
                  >
                    Usuń
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form className="milestone-form" onSubmit={addMilestone}>
            <input
              value={msName}
              onChange={(e) => setMsName(e.target.value)}
              placeholder="Nazwa kamienia milowego"
              aria-label="Nazwa kamienia milowego"
            />
            <input
              type="date"
              value={msDate}
              onChange={(e) => setMsDate(e.target.value)}
              aria-label="Data kamienia milowego"
            />
            <button type="submit" className="btn soft" disabled={!msName.trim()}>
              Dodaj kamień milowy
            </button>
            {msError && <p className="field-error">{msError}</p>}
          </form>
        )}
      </div>

      <div className="editor-section">
        <div className="section-head">
          <h2>Zadania ({tasks.length})</h2>
          {canManageTasks && (
            <button
              type="button"
              className="btn soft"
              onClick={() => openNewTask(project.id)}
            >
              + Nowe zadanie
            </button>
          )}
        </div>
        <p className="field-hint">
          Zaplanowano {formatDuration(projectPlannedTotal(state, project.id))} w całym projekcie.
        </p>
        {tasks.length === 0 ? (
          <p className="field-hint">W tym projekcie nie ma jeszcze zadań.</p>
        ) : (
          <ul className="project-task-list">
            {tasks.map((t) => (
              <li key={t.id} className="project-task-row">
                <button
                  type="button"
                  className="project-task-main"
                  onClick={() => openTask(t.id)}
                >
                  <span className="task-title">{t.title}</span>
                  <StatusBadge status={getStatus(state, t.statusId)} />
                  <PlanningBadge status={taskPlanningStatus(state, t.id)} />
                  <span className="muted">
                    {formatShort(t.startDate)} – {formatShort(t.endDate)} ·{' '}
                    {formatDuration(taskPlannedTotal(state, t.id))}
                  </span>
                  <span className="task-card-assignees">
                    {assigneesOfTask(state, t.id).map((p) => (
                      <PersonChip key={p.id} person={p} />
                    ))}
                  </span>
                  <ChevronRight className="card-chevron" size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="editor-section">
        <h2>Dyskusja</h2>
        <CommentsPanel entityType="project" entityId={project.id} />
      </div>
    </section>
  );
}
