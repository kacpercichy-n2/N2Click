// Employee profile: avatar, name, job title, department, editable details,
// assigned projects/tasks, and this week's workload/availability.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { PersonDraft } from '../store/AppStore';
import {
  availableHoursInRange,
  getDepartment,
  getStatus,
  hoursForPersonOnDate,
  personCapacity,
  personTotalHours,
  projectsOfPerson,
  taskIdsOfPerson,
  taskPlannedTotalForPerson,
  wouldCreateSupervisorCycle,
} from '../store/selectors';
import { ROLE_LABELS, can, NO_PERM_TITLE } from '../store/permissions';
import { hashPassword } from '../utils/password';
import type { AccessRole, Person } from '../types';
import { Avatar } from '../components/Avatar';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { DEFAULT_CAPACITY, defaultWorkEndMinutes } from '../store/storage';
import { useOpenTask } from '../components/TaskModal';
import { formatRowLabel, formatShort, isWeekend, todayStr, weekDays } from '../utils/dates';
import { formatDuration, formatMinutes } from '../utils/time';
import {
  END_MINUTE_OPTIONS,
  START_MINUTE_OPTIONS,
  WEEKDAY_CHIPS,
  formatWorkDays,
  toggleWorkDay,
} from '../components/personFields';

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
  const canManage = can(
    state.people.find((p) => p.id === state.currentUserId),
    'people.manage',
    { peopleCount: state.people.length },
  );
  const isOwn = personId === state.currentUserId;
  const canEdit = canManage || isOwn;
  // Self-editing without people.manage: profile is editable, but role + capacity
  // (org-level fields) stay locked.
  const restrictedSelf = isOwn && !canManage;

  const [draft, setDraft] = useState<PersonDraft>(() => ({
    firstName: person?.firstName ?? '',
    lastName: person?.lastName ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    role: person?.role ?? '',
    departmentId: person?.departmentId ?? '',
    avatar: person?.avatar ?? '',
    capacity: person?.capacity ?? DEFAULT_CAPACITY,
    accessRole: person?.accessRole ?? 'pracownik',
    workDays: person?.workDays ?? [1, 2, 3, 4, 5],
    workStartMinutes: person?.workStartMinutes ?? 480,
    workEndMinutes: person?.workEndMinutes ?? defaultWorkEndMinutes(person?.capacity ?? DEFAULT_CAPACITY),
    supervisorId: person?.supervisorId ?? '',
  }));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  if (!person) return null;

  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const hoursInvalid = draft.workEndMinutes <= draft.workStartMinutes;

  const save = () => {
    if (!draft.firstName.trim()) return;
    if (hoursInvalid) {
      setError('Koniec pracy musi być po początku');
      return;
    }
    setError('');
    dispatch({ type: 'UPDATE_PERSON', personId: person.id, person: draft });
    setEditing(false);
  };

  // Supervisor candidates: everyone except this person and anyone whose
  // selection would form a cycle (reuses the pure guard the reducer uses).
  const supervisorOptions = state.people.filter(
    (p) =>
      p.id !== person.id &&
      !wouldCreateSupervisorCycle(state.people, person.id, p.id),
  );

  const projects = projectsOfPerson(state, person.id);
  const taskIds = new Set(taskIdsOfPerson(state, person.id));
  const tasks = state.tasks.filter((t) => taskIds.has(t.id));
  const week = weekDays(todayStr());
  const capacity = personCapacity(state, person.id);
  const weekHours = week.reduce(
    (s, d) => s + hoursForPersonOnDate(state, person.id, d),
    0,
  );
  const available = availableHoursInRange(state, person.id, week);

  return (
    <section className="page editor">
      <div className="page-head">
        <h1 className="profile-title">
          <Avatar person={person} size={44} />
          <span>
            {person.name}
            {person.accessRole === 'administrator' && (
              <span className="admin-tag">administrator</span>
            )}
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
          {canEdit && (
            <button type="button" className="btn soft" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Zamknij edycję' : 'Edytuj profil'}
            </button>
          )}
        </div>
      </div>

      {canEdit && editing && (
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
            <div className="field">
              <label htmlFor="pp-phone">Telefon</label>
              <input
                id="pp-phone"
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="opcjonalnie"
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
                disabled={restrictedSelf}
                title={restrictedSelf ? NO_PERM_TITLE : undefined}
              />
            </div>
            <div className="field field-narrow">
              <label htmlFor="pp-role-access">Uprawnienia</label>
              <select
                id="pp-role-access"
                value={draft.accessRole}
                onChange={(e) => set('accessRole', e.target.value as AccessRole)}
                disabled={restrictedSelf}
                title={restrictedSelf ? NO_PERM_TITLE : undefined}
              >
                {(Object.keys(ROLE_LABELS) as AccessRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Dni robocze</label>
              <div className="weekday-chips" role="group" aria-label="Dni robocze">
                {WEEKDAY_CHIPS.map((c) => (
                  <label
                    key={c.iso}
                    className={`weekday-chip${draft.workDays.includes(c.iso) ? ' on' : ''}`}
                    title={restrictedSelf ? NO_PERM_TITLE : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={draft.workDays.includes(c.iso)}
                      disabled={restrictedSelf}
                      onChange={() => set('workDays', toggleWorkDay(draft.workDays, c.iso))}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field field-narrow">
              <label htmlFor="pp-work-start">Praca od</label>
              <select
                id="pp-work-start"
                value={draft.workStartMinutes}
                onChange={(e) => {
                  set('workStartMinutes', Number(e.target.value));
                  if (error) setError('');
                }}
                disabled={restrictedSelf}
                title={restrictedSelf ? NO_PERM_TITLE : undefined}
              >
                {START_MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field field-narrow">
              <label htmlFor="pp-work-end">Praca do</label>
              <select
                id="pp-work-end"
                value={draft.workEndMinutes}
                onChange={(e) => {
                  set('workEndMinutes', Number(e.target.value));
                  if (error) setError('');
                }}
                disabled={restrictedSelf}
                title={restrictedSelf ? NO_PERM_TITLE : undefined}
              >
                {END_MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pp-supervisor">Przełożony</label>
              <select
                id="pp-supervisor"
                value={draft.supervisorId}
                onChange={(e) => set('supervisorId', e.target.value)}
                disabled={restrictedSelf}
                title={restrictedSelf ? NO_PERM_TITLE : undefined}
              >
                <option value="">—</option>
                {supervisorOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="field-hint">Limit dzienny liczony jest z pola dostępności.</p>
          {error && <p className="field-error">{error}</p>}
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

      <ProfileFacts person={person} />

      <PasswordSection person={person} />

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

/**
 * Read-only profile facts: telefon, dni robocze, godziny pracy, przełożony and
 * podwładni (the latter linked to their profiles; row omitted when empty).
 */
function ProfileFacts({ person }: { person: Person }) {
  const { state } = useStore();
  const supervisor = person.supervisorId
    ? state.people.find((p) => p.id === person.supervisorId)
    : undefined;
  const subordinates = state.people.filter((p) => p.supervisorId === person.id);

  return (
    <div className="editor-section">
      <h2>Informacje</h2>
      <dl className="profile-facts">
        {person.phone && (
          <div className="profile-fact">
            <dt>Telefon</dt>
            <dd>{person.phone}</dd>
          </div>
        )}
        <div className="profile-fact">
          <dt>Dni robocze</dt>
          <dd>{formatWorkDays(person.workDays)}</dd>
        </div>
        <div className="profile-fact">
          <dt>Godziny pracy</dt>
          <dd>
            {formatMinutes(person.workStartMinutes)}–{formatMinutes(person.workEndMinutes)}
          </dd>
        </div>
        <div className="profile-fact">
          <dt>Przełożony</dt>
          <dd>
            {supervisor ? (
              <Link to={`/people/${supervisor.id}`} className="profile-link">
                {supervisor.name}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {subordinates.length > 0 && (
          <div className="profile-fact">
            <dt>Podwładni</dt>
            <dd className="profile-fact-links">
              {subordinates.map((p, i) => (
                <span key={p.id}>
                  <Link to={`/people/${p.id}`} className="profile-link">
                    {p.name}
                  </Link>
                  {i < subordinates.length - 1 ? ', ' : ''}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * Password set/change/clear. Visible on your OWN profile or to anyone with
 * `people.manage` (administrators). Passwords are cosmetic client-side gating
 * (see utils/password.ts): min 4 chars, both fields must match, hashed BEFORE
 * dispatch (the reducer stays sync). Admins additionally get `Usuń hasło` — the
 * documented recovery path so a passwordless person can always log in.
 */
function PasswordSection({ person }: { person: Person }) {
  const { state, dispatch } = useStore();
  const currentUser = state.people.find((p) => p.id === state.currentUserId);
  const opts = { peopleCount: state.people.length };
  const canManage = can(currentUser, 'people.manage', opts);
  const isOwn = person.id === state.currentUserId;
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOwn && !canManage) return null;

  const hasHash = person.passwordHash !== '';

  const submit = async () => {
    if (busy) return;
    setNotice('');
    if (newPass.length < 4) {
      setError('Hasło musi mieć co najmniej 4 znaki');
      return;
    }
    if (newPass !== confirm) {
      setError('Hasła muszą być takie same');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const passwordHash = await hashPassword(newPass);
      dispatch({ type: 'SET_PASSWORD', personId: person.id, passwordHash });
      setNewPass('');
      setConfirm('');
      setNotice(hasHash ? 'Hasło zmienione.' : 'Hasło ustawione.');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    if (!window.confirm(`Usunąć hasło osoby ${person.name}? Będzie mogła logować się bez hasła.`)) {
      return;
    }
    dispatch({ type: 'SET_PASSWORD', personId: person.id, passwordHash: '' });
    setNewPass('');
    setConfirm('');
    setError('');
    setNotice('Hasło usunięte.');
  };

  return (
    <div className="editor-section">
      <h2>Hasło</h2>
      <p className="field-hint">
        {hasHash ? 'Ta osoba ma ustawione hasło.' : 'Ta osoba loguje się bez hasła.'}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pp-newpass">Nowe hasło</label>
          <input
            id="pp-newpass"
            type="password"
            value={newPass}
            onChange={(e) => {
              setNewPass(e.target.value);
              if (error) setError('');
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="pp-confirmpass">Powtórz hasło</label>
          <input
            id="pp-confirmpass"
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (error) setError('');
            }}
          />
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      {notice && <p className="field-hint">{notice}</p>}
      <div className="editor-actions">
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>
          {hasHash ? 'Zmień hasło' : 'Ustaw hasło'}
        </button>
        {canManage && hasHash && (
          <button type="button" className="btn danger-ghost" onClick={clear} disabled={busy}>
            Usuń hasło
          </button>
        )}
      </div>
    </div>
  );
}
