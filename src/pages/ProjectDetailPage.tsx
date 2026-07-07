// Project detail card: editable fields (client, status, paid coin, dates,
// department, service type, description), milestones, the project's tasks, and
// the chat/comments + activity section.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { ProjectDraft } from '../store/AppStore';
import {
  activeStatuses,
  assigneesOfTask,
  getStatus,
  milestonesOfProject,
  projectPlannedTotal,
  taskPlannedTotal,
  tasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { PersonChip } from '../components/PersonChip';
import { CommentsPanel } from '../components/CommentsPanel';
import { useOpenTask } from '../components/TaskModal';
import { formatShort, todayStr } from '../utils/dates';

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const { state } = useStore();
  const project = state.projects.find((p) => p.id === id);

  if (!project) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Project not found</p>
          <Link to="/projects" className="btn primary">
            Back to projects
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
      setError('Project name is required');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date');
      return;
    }
    const draft: ProjectDraft = {
      clientId,
      name: trimmed,
      description: description.trim(),
      statusId,
      paid: project.paid,
      startDate,
      endDate,
      departmentId,
      serviceTypeId,
    };
    dispatch({ type: 'SAVE_PROJECT', projectId: project.id, draft });
    setError('');
  };

  const togglePaid = () =>
    dispatch({ type: 'SET_PROJECT_PAID', projectId: project.id, paid: !project.paid });

  const remove = () => {
    if (
      window.confirm(
        `Delete project "${project.name}"? This removes its ${tasks.length} task(s), assignments, planned hours, milestones, and comments.`,
      )
    ) {
      dispatch({ type: 'DELETE_PROJECT', projectId: project.id });
      navigate('/projects');
    }
  };

  const addMilestone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msName.trim()) return;
    dispatch({
      type: 'SAVE_MILESTONE',
      milestoneId: null,
      projectId: project.id,
      name: msName,
      date: msDate,
    });
    setMsName('');
  };

  const dirty =
    name !== project.name ||
    description !== project.description ||
    clientId !== project.clientId ||
    statusId !== project.statusId ||
    startDate !== project.startDate ||
    endDate !== project.endDate ||
    departmentId !== project.departmentId ||
    serviceTypeId !== project.serviceTypeId;

  return (
    <section className="page editor">
      <div className="page-head">
        <h1 className="project-detail-title">
          <Coin paid={project.paid} size={24} onToggle={togglePaid} />
          {project.name}
          <StatusBadge status={currentStatus} />
        </h1>
        <div className="page-head-actions">
          <Link to="/projects" className="btn ghost">
            Back
          </Link>
          <button type="button" className="btn danger-ghost" onClick={remove}>
            Delete project
          </button>
        </div>
      </div>

      <div className="editor-section">
        <h2>Details</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pd-name">Name *</label>
            <input id="pd-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pd-client">Client</label>
            <select
              id="pd-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
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
            >
              {pickableStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.archived ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pd-start">Start date</label>
            <input
              id="pd-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pd-end">End date</label>
            <input
              id="pd-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pd-dep">Department</label>
            <select
              id="pd-dep"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
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
            <label htmlFor="pd-svc">Service type</label>
            <select
              id="pd-svc"
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
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
          <label htmlFor="pd-desc">Description</label>
          <textarea
            id="pd-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field-row payment-row">
          <span className="field-hint">
            Payment: <Coin paid={project.paid} onToggle={togglePaid} />{' '}
            <strong>{project.paid ? 'Paid' : 'Unpaid'}</strong> (click the coin to toggle)
          </span>
        </div>
        {error && <p className="field-error">{error}</p>}
        {dirty && (
          <div className="editor-actions">
            <button type="button" className="btn primary" onClick={save}>
              Save changes
            </button>
          </div>
        )}
      </div>

      <div className="editor-section">
        <h2>Milestones</h2>
        {milestones.length === 0 ? (
          <p className="field-hint">No milestones yet.</p>
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
                  onChange={(e) =>
                    dispatch({
                      type: 'MOVE_MILESTONE',
                      milestoneId: m.id,
                      date: e.target.value,
                    })
                  }
                  aria-label={`Date for ${m.name}`}
                />
                <button
                  type="button"
                  className="btn danger-ghost"
                  onClick={() => dispatch({ type: 'DELETE_MILESTONE', milestoneId: m.id })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="milestone-form" onSubmit={addMilestone}>
          <input
            value={msName}
            onChange={(e) => setMsName(e.target.value)}
            placeholder="Milestone name"
            aria-label="Milestone name"
          />
          <input
            type="date"
            value={msDate}
            onChange={(e) => setMsDate(e.target.value)}
            aria-label="Milestone date"
          />
          <button type="submit" className="btn soft" disabled={!msName.trim()}>
            Add milestone
          </button>
        </form>
      </div>

      <div className="editor-section">
        <div className="section-head">
          <h2>Tasks ({tasks.length})</h2>
          <button
            type="button"
            className="btn soft"
            onClick={() => openNewTask(project.id)}
          >
            + New task
          </button>
        </div>
        <p className="field-hint">
          {fmtHours(projectPlannedTotal(state, project.id))}h planned across the project.
        </p>
        {tasks.length === 0 ? (
          <p className="field-hint">No tasks in this project yet.</p>
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
                  <span className="muted">
                    {formatShort(t.startDate)} – {formatShort(t.endDate)} ·{' '}
                    {fmtHours(taskPlannedTotal(state, t.id))}h
                  </span>
                  <span className="task-card-assignees">
                    {assigneesOfTask(state, t.id).map((p) => (
                      <PersonChip key={p.id} person={p} />
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="editor-section">
        <h2>Discussion</h2>
        <CommentsPanel entityType="project" entityId={project.id} />
      </div>
    </section>
  );
}
