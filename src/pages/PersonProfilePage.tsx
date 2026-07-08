// Employee profile: avatar, name, job title, department, editable details,
// assigned projects/tasks, and this week's workload/availability.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { PersonDraft } from '../store/AppStore';
import {
  getDepartment,
  getStatus,
  hoursForPersonOnDate,
  personCapacity,
  personTotalHours,
  projectsOfPerson,
  taskIdsOfPerson,
  taskPlannedTotalForPerson,
} from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { DEFAULT_CAPACITY } from '../store/storage';
import { useOpenTask } from '../components/TaskModal';
import { formatRowLabel, formatShort, isWeekend, todayStr, weekDays } from '../utils/dates';
import { formatDuration } from '../utils/time';

export function PersonProfilePage() {
  const { id } = useParams();
  const { state } = useStore();
  const person = state.people.find((p) => p.id === id);
  if (!person) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Nie znaleziono osoby</p>
          <Link to="/people" className="btn primary">
            Wróć do zespołu
          </Link>
        </div>
      </section>
    );
  }
  return <PersonProfile key={person.id} personId={person.id} />;
}

function PersonProfile({ personId }: { personId: string }) {
  const navigate = useNavigate();
  const { openTask } = useOpenTask();
  const { state, dispatch } = useStore();
  const person = state.people.find((p) => p.id === personId);

  const [draft, setDraft] = useState<PersonDraft>(() => ({
    firstName: person?.firstName ?? '',
    lastName: person?.lastName ?? '',
    email: person?.email ?? '',
    role: person?.role ?? '',
    departmentId: person?.departmentId ?? '',
    avatar: person?.avatar ?? '',
    capacity: person?.capacity ?? DEFAULT_CAPACITY,
    isAdmin: person?.isAdmin ?? false,
  }));
  const [editing, setEditing] = useState(false);

  if (!person) return null;

  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    if (!draft.firstName.trim()) return;
    dispatch({ type: 'UPDATE_PERSON', personId: person.id, person: draft });
    setEditing(false);
  };

  const projects = projectsOfPerson(state, person.id);
  const taskIds = new Set(taskIdsOfPerson(state, person.id));
  const tasks = state.tasks.filter((t) => taskIds.has(t.id));
  const week = weekDays(todayStr());
  const capacity = personCapacity(state, person.id);
  const weekHours = week.reduce(
    (s, d) => s + hoursForPersonOnDate(state, person.id, d),
    0,
  );
  const available = week.filter((d) => !isWeekend(d)).length * capacity;

  return (
    <section className="page editor">
      <div className="page-head">
        <h1 className="profile-title">
          <Avatar person={person} size={44} />
          <span>
            {person.name}
            {person.isAdmin && <span className="admin-tag">administrator</span>}
            <span className="profile-subtitle">
              {[person.role, getDepartment(state, person.departmentId)?.name]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </h1>
        <div className="page-head-actions">
          <Link to="/people" className="btn ghost">
            Wróć
          </Link>
          <button type="button" className="btn soft" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Zamknij edycję' : 'Edytuj profil'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="editor-section">
          <h2>Edytuj profil</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pp-first">Imię *</label>
              <input
                id="pp-first"
                value={draft.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pp-last">Nazwisko</label>
              <input
                id="pp-last"
                value={draft.lastName}
                onChange={(e) => set('lastName', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pp-role">Stanowisko</label>
              <input id="pp-role" value={draft.role} onChange={(e) => set('role', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pp-dep">Dział</label>
              <select
                id="pp-dep"
                value={draft.departmentId}
                onChange={(e) => set('departmentId', e.target.value)}
              >
                <option value="">—</option>
                {state.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pp-email">Email</label>
              <input
                id="pp-email"
                type="email"
                value={draft.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
            <div className="field field-narrow">
              <label htmlFor="pp-avatar">Avatar</label>
              <input
                id="pp-avatar"
                value={draft.avatar}
                onChange={(e) => set('avatar', e.target.value)}
                maxLength={4}
                placeholder="🙂"
              />
            </div>
            <div className="field field-narrow">
              <label htmlFor="pp-cap">Godziny/dzień</label>
              <input
                id="pp-cap"
                type="number"
                min={1}
                max={24}
                step={0.5}
                value={draft.capacity}
                onChange={(e) => set('capacity', Number(e.target.value) || DEFAULT_CAPACITY)}
              />
            </div>
            <label className="field-check">
              <input
                type="checkbox"
                checked={draft.isAdmin}
                onChange={(e) => set('isAdmin', e.target.checked)}
              />
              Administrator
            </label>
          </div>
          <div className="editor-actions">
            <button
              type="button"
              className="btn primary"
              onClick={save}
              disabled={!draft.firstName.trim()}
            >
              Zapisz profil
            </button>
          </div>
        </div>
      )}

      <div className="editor-section">
        <h2>Ten tydzień</h2>
        <p>
          Przypisano <strong>{formatDuration(weekHours)}</strong> z{' '}
          <strong>{formatDuration(available)}</strong> dostępnych ({formatDuration(capacity)}/dzień) ·{' '}
          łącznie przypisano {formatDuration(personTotalHours(state, person.id))}.
        </p>
        <div className="profile-week">
          {week.map((d) => {
            const h = hoursForPersonOnDate(state, person.id, d);
            const over = h > capacity;
            return (
              <div
                key={d}
                className={[
                  'profile-day',
                  isWeekend(d) ? 'weekend' : '',
                  over ? 'overload' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="profile-day-label">{formatRowLabel(d)}</span>
                <span className="profile-day-hours">
                  {h === 0 ? '—' : formatDuration(h)}
                  {over && ' ⚠'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="editor-section">
        <h2>Projekty ({projects.length})</h2>
        {projects.length === 0 ? (
          <p className="field-hint">Ta osoba nie jest jeszcze w żadnym projekcie.</p>
        ) : (
          <ul className="project-task-list">
            {projects.map((p) => (
              <li key={p.id} className="project-task-row">
                <button
                  type="button"
                  className="project-task-main"
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  <Coin paid={p.paid} size={14} />
                  <span className="task-title">{p.name}</span>
                  <StatusBadge status={getStatus(state, p.statusId)} />
                  <span className="muted">
                    {formatShort(p.startDate)} – {formatShort(p.endDate)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="editor-section">
        <h2>Zadania ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p className="field-hint">Brak przypisanych zadań.</p>
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
                    {formatDuration(taskPlannedTotalForPerson(state, t.id, person.id))} dla{' '}
                    {person.firstName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
