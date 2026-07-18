// Employee profile: avatar, name, job title, department, editable details,
// assigned projects/tasks, and this week's workload/availability.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { PersonDraft } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import {
  canEditLocalPassword,
  canUploadAvatarPhoto,
  editableProfileFields,
  type ProfileField,
} from './profileEditPolicy';
import {
  fetchAvatarProfile,
  removeAvatar,
  resolveAvatarUrl,
  uploadAvatar,
} from '../supabase/avatarStorage';
import { validateAvatarFile } from '../supabase/avatarFile';
import {
  availableHoursInRange,
  getDepartment,
  currentUser,
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
  const auth = useAuth();
  const person = state.people.find((p) => p.id === personId);
  const actor = currentUser(state);
  const peopleCount = state.people.length;
  const isOwn = personId === state.currentUserId;
  // Pure role/department policy drives which fields are editable. `save()` takes
  // locked fields from the current `person`, never from the (disabled) draft.
  const fields: ReadonlySet<ProfileField> = person
    ? editableProfileFields(actor, person, { peopleCount })
    : new Set<ProfileField>();
  const allow = (f: ProfileField) => fields.has(f);
  const canEdit = fields.size > 0;
  const canUploadPhoto = person
    ? canUploadAvatarPhoto(actor, person, auth.mode, { peopleCount })
    : false;

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
    // Merge the draft over the current person, taking ONLY permitted fields;
    // locked fields keep the person's current value (never the disabled input).
    const merged: PersonDraft = {
      firstName: allow('firstName') ? draft.firstName : person.firstName,
      lastName: allow('lastName') ? draft.lastName : person.lastName,
      email: allow('email') ? draft.email : person.email,
      phone: allow('phone') ? draft.phone : person.phone,
      role: allow('roleTitle') ? draft.role : person.role,
      departmentId: allow('departmentId') ? draft.departmentId : person.departmentId,
      avatar: allow('avatarEmoji') ? draft.avatar : person.avatar,
      capacity: allow('capacity') ? draft.capacity : person.capacity,
      accessRole: allow('accessRole') ? draft.accessRole : person.accessRole,
      workDays: allow('workDays') ? draft.workDays : person.workDays,
      workStartMinutes: allow('workHours') ? draft.workStartMinutes : person.workStartMinutes,
      workEndMinutes: allow('workHours') ? draft.workEndMinutes : person.workEndMinutes,
      supervisorId: allow('supervisorId') ? draft.supervisorId : person.supervisorId,
    };
    if (!merged.firstName.trim()) return;
    if (allow('workHours') && hoursInvalid) {
      setError('Koniec pracy musi być po początku');
      return;
    }
    setError('');
    dispatch({ type: 'UPDATE_PERSON', personId: person.id, person: merged });
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
                disabled={!allow('firstName')}
                title={allow('firstName') ? undefined : NO_PERM_TITLE}
              />
            </div>
            <div className="field">
              <label htmlFor="pp-last">Nazwisko</label>
              <input
                id="pp-last"
                value={draft.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                disabled={!allow('lastName')}
                title={allow('lastName') ? undefined : NO_PERM_TITLE}
              />
            </div>
            <div className="field">
              <label htmlFor="pp-role">Stanowisko</label>
              <input
                id="pp-role"
                value={draft.role}
                onChange={(e) => set('role', e.target.value)}
                disabled={!allow('roleTitle')}
                title={allow('roleTitle') ? undefined : NO_PERM_TITLE}
              />
            </div>
            <div className="field">
              <label htmlFor="pp-dep">Dział</label>
              <select
                id="pp-dep"
                value={draft.departmentId}
                onChange={(e) => set('departmentId', e.target.value)}
                disabled={!allow('departmentId')}
                title={allow('departmentId') ? undefined : NO_PERM_TITLE}
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
                disabled={!allow('email')}
                title={allow('email') ? undefined : NO_PERM_TITLE}
              />
            </div>
            <div className="field">
              <label htmlFor="pp-phone">Telefon</label>
              <input
                id="pp-phone"
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="opcjonalnie"
                disabled={!allow('phone')}
                title={allow('phone') ? undefined : NO_PERM_TITLE}
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
                disabled={!allow('avatarEmoji')}
                title={allow('avatarEmoji') ? undefined : NO_PERM_TITLE}
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
                disabled={!allow('capacity')}
                title={allow('capacity') ? undefined : NO_PERM_TITLE}
              />
            </div>
            <div className="field field-narrow">
              <label htmlFor="pp-role-access">Uprawnienia</label>
              <select
                id="pp-role-access"
                value={draft.accessRole}
                onChange={(e) => set('accessRole', e.target.value as AccessRole)}
                disabled={!allow('accessRole')}
                title={allow('accessRole') ? undefined : NO_PERM_TITLE}
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
                    title={allow('workDays') ? undefined : NO_PERM_TITLE}
                  >
                    <input
                      type="checkbox"
                      checked={draft.workDays.includes(c.iso)}
                      disabled={!allow('workDays')}
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
                disabled={!allow('workHours')}
                title={allow('workHours') ? undefined : NO_PERM_TITLE}
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
                disabled={!allow('workHours')}
                title={allow('workHours') ? undefined : NO_PERM_TITLE}
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
                disabled={!allow('supervisorId')}
                title={allow('supervisorId') ? undefined : NO_PERM_TITLE}
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

      {canUploadPhoto && (
        <AvatarPhotoSection
          person={person}
          isSelf={isOwn}
          sessionUserId={auth.state.session?.user?.id ?? null}
        />
      )}

      <ProfileFacts person={person} />

      {canEditLocalPassword(auth.mode) && <PasswordSection person={person} />}

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
 * "Zdjęcie profilowe" — private-bucket avatar photo (Supabase mode only). The
 * parent renders this ONLY when `canUploadAvatarPhoto` is true, so it never
 * mounts (and never touches the Supabase client) in local mode. Retrieval is
 * always via a signed URL; failures fall back to initials/emoji, never block.
 */
function AvatarPhotoSection({
  person,
  isSelf,
  sessionUserId,
}: {
  person: Person;
  isSelf: boolean;
  sessionUserId: string | null;
}) {
  type Phase = 'loading' | 'ready' | 'no-account' | 'error';
  const [phase, setPhase] = useState<Phase>('loading');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const email = person.email;

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError('');
    setNotice('');
    setPhotoUrl(null);
    void (async () => {
      const res = await fetchAvatarProfile(email);
      if (cancelled) return;
      if (!res.ok) {
        setPhase('error');
        setError(res.error);
        return;
      }
      // Self: prefer the authoritative session id; the email row (if any) only
      // supplies the current avatar_path.
      if (isSelf && sessionUserId) {
        const path = res.profile?.avatarPath ?? null;
        setProfileId(sessionUserId);
        setAvatarPath(path);
        setPhase('ready');
        if (path) {
          const url = await resolveAvatarUrl(path);
          if (!cancelled) setPhotoUrl(url);
        }
        return;
      }
      if (!res.profile) {
        setPhase('no-account');
        return;
      }
      setProfileId(res.profile.profileId);
      setAvatarPath(res.profile.avatarPath);
      setPhase('ready');
      if (res.profile.avatarPath) {
        const url = await resolveAvatarUrl(res.profile.avatarPath);
        if (!cancelled) setPhotoUrl(url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, isSelf, sessionUserId]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profileId || busy) return;
    setError('');
    setNotice('');
    const check = validateAvatarFile({ name: file.name, type: file.type, size: file.size });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    const res = await uploadAvatar({ profileId, file, ext: check.ext, previousPath: avatarPath });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    setAvatarPath(res.path);
    setNotice('Zapisano awatar.');
    const url = await resolveAvatarUrl(res.path);
    setPhotoUrl(url);
    setBusy(false);
  };

  const onRemove = async () => {
    if (!profileId || !avatarPath || busy) return;
    setError('');
    setNotice('');
    setBusy(true);
    const res = await removeAvatar({ profileId, avatarPath });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    setAvatarPath(null);
    setPhotoUrl(null);
    setNotice('Usunięto zdjęcie.');
    setBusy(false);
  };

  return (
    <div className="editor-section">
      <h2>Zdjęcie profilowe</h2>
      {phase === 'loading' && (
        <p className="field-hint" role="status">
          Ładowanie zdjęcia…
        </p>
      )}
      {phase === 'error' && (
        <p className="field-error" role="alert">
          {error || 'Nie udało się wczytać zdjęcia.'}
        </p>
      )}
      {phase === 'no-account' && (
        <p className="field-hint">
          Ta osoba nie ma jeszcze konta — zdjęcie profilowe będzie dostępne po jego utworzeniu.
        </p>
      )}
      {phase === 'ready' && (
        <div className="avatar-photo-section">
          <Avatar person={person} size={72} photoUrl={photoUrl ?? undefined} />
          <div className="avatar-photo-controls">
            <label className="btn soft" htmlFor="pp-photo">
              {busy ? 'Wysyłanie…' : photoUrl ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
            </label>
            <input
              id="pp-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={busy}
              onChange={(e) => void onFile(e)}
              style={{ display: 'none' }}
            />
            {avatarPath && (
              <button
                type="button"
                className="btn danger-ghost"
                disabled={busy}
                onClick={() => void onRemove()}
              >
                Usuń zdjęcie
              </button>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="field-hint" role="status">
                {notice}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
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
