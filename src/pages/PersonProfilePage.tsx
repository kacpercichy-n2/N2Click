// Employee profile: one integrated panel. Basic data (avatar + name/role/dept/
// company) sits in the first card with an in-place pencil bubble for the photo;
// remaining fields follow in the same panel. Every field renders as an
// input/select when policy allows it, otherwise as read-only text. Sekcje
// „Ten tydzień"/„Projekty"/„Zadania" są widoczne dla KAŻDEGO (decyzja
// 2026-07-22: widoczność steruje się filtrowaniem, nie rolą — dawna bramka
// canViewProfileDetails z runu 256 celowo NIE została przeniesiona).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { PersonDraft } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import {
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
  getStatus,
  hoursForPersonOnDate,
  personCapacity,
  personTotalHours,
  projectsOfPerson,
  taskIdsOfPerson,
  taskPlannedTotalForPerson,
  wouldCreateSupervisorCycle,
} from '../store/selectors';
import { can } from '../store/permissions';
import { hashPassword } from '../utils/password';
import { jobTitleSelectOptions } from '../utils/roleTitles';
import type { Person } from '../types';
import { Avatar } from '../components/Avatar';
import { QuickAddModal, NEW_OPTION_VALUE } from '../components/QuickAddModal';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { DEFAULT_CAPACITY, defaultWorkEndMinutes } from '../store/storage';
import { useOpenTask } from '../components/TaskModal';
import {
  formatBirthday,
  formatRowLabel,
  formatShortWithWeekday,
  isWeekend,
  todayStr,
  weekDays,
} from '../utils/dates';
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
  const actor = state.people.find((p) => p.id === state.currentUserId);
  const peopleCount = state.people.length;
  const isOwn = personId === state.currentUserId;
  // Pure role policy drives which fields are editable. `save()` takes locked
  // fields from the current `person`, never from the (absent) draft input.
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
    companyId: person?.companyId ?? '',
    avatar: person?.avatar ?? '',
    capacity: person?.capacity ?? DEFAULT_CAPACITY,
    accessRole: person?.accessRole ?? 'pelne',
    workDays: person?.workDays ?? [1, 2, 3, 4, 5],
    workStartMinutes: person?.workStartMinutes ?? 480,
    workEndMinutes: person?.workEndMinutes ?? defaultWorkEndMinutes(person?.capacity ?? DEFAULT_CAPACITY),
    supervisorId: person?.supervisorId ?? '',
    birthDate: person?.birthDate ?? '',
    emailNotifications: person?.emailNotifications ?? false,
  }));
  const [error, setError] = useState('');

  // „+ Nowe…" w selektach słownikowych: który modal szybkiego dodania jest
  // otwarty. Nowy dział/spółka dostają id w reduktorze, więc świeży wpis
  // namierzamy po znormalizowanej nazwie w efekcie poniżej i dopiero wtedy
  // ustawiamy go w drafcie (stanowisko to wolny tekst — ustawiane od razu).
  const [quickAdd, setQuickAdd] = useState<null | 'jobTitle' | 'department' | 'company'>(null);
  const [pendingDict, setPendingDict] = useState<null | {
    kind: 'department' | 'company';
    name: string;
  }>(null);
  useEffect(() => {
    if (!pendingDict) return;
    const key = pendingDict.name.trim().toLocaleLowerCase('pl-PL');
    const list = pendingDict.kind === 'department' ? state.departments : state.companies;
    const match = list.find((e) => e.name.trim().toLocaleLowerCase('pl-PL') === key);
    if (match) {
      setDraft((d) =>
        pendingDict.kind === 'department'
          ? { ...d, departmentId: match.id }
          : { ...d, companyId: match.id },
      );
      setPendingDict(null);
    }
  }, [pendingDict, state.departments, state.companies]);

  if (!person) return null;

  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const hoursInvalid = draft.workEndMinutes <= draft.workStartMinutes;

  const save = () => {
    // Merge the draft over the current person, taking ONLY permitted fields;
    // locked fields keep the person's current value (never a read-only draft).
    const merged: PersonDraft = {
      firstName: allow('firstName') ? draft.firstName : person.firstName,
      lastName: allow('lastName') ? draft.lastName : person.lastName,
      email: allow('email') ? draft.email : person.email,
      phone: allow('phone') ? draft.phone : person.phone,
      role: allow('roleTitle') ? draft.role : person.role,
      departmentId: allow('departmentId') ? draft.departmentId : person.departmentId,
      companyId: allow('companyId') ? draft.companyId : person.companyId ?? '',
      avatar: allow('avatarEmoji') ? draft.avatar : person.avatar,
      capacity: allow('capacity') ? draft.capacity : person.capacity,
      accessRole: allow('accessRole') ? draft.accessRole : person.accessRole,
      workDays: allow('workDays') ? draft.workDays : person.workDays,
      workStartMinutes: allow('workHours') ? draft.workStartMinutes : person.workStartMinutes,
      workEndMinutes: allow('workHours') ? draft.workEndMinutes : person.workEndMinutes,
      supervisorId: allow('supervisorId') ? draft.supervisorId : person.supervisorId,
      birthDate: allow('birthDate') ? draft.birthDate : person.birthDate,
      emailNotifications: allow('emailNotifications')
        ? draft.emailNotifications
        : person.emailNotifications ?? false,
    };
    if (!merged.firstName.trim()) return;
    if (allow('workHours') && hoursInvalid) {
      setError('Koniec pracy musi być po początku');
      return;
    }
    setError('');
    dispatch({ type: 'UPDATE_PERSON', personId: person.id, person: merged });
  };

  // Supervisor candidates: everyone except this person and anyone whose
  // selection would form a cycle (reuses the pure guard the reducer uses).
  const supervisorOptions = state.people.filter(
    (p) =>
      p.id !== person.id &&
      !wouldCreateSupervisorCycle(state.people, person.id, p.id),
  );
  const supervisor = person.supervisorId
    ? state.people.find((p) => p.id === person.supervisorId)
    : undefined;
  const subordinates = state.people.filter((p) => p.supervisorId === person.id);

  const projects = projectsOfPerson(state, person.id);
  const taskIds = new Set(taskIdsOfPerson(state, person.id));
  // Szkice nie „trafiają do osób” — profil pokazuje tylko opublikowane zadania
  // (szkic jest widoczny wyłącznie w widoku projektu do czasu publikacji).
  const tasks = state.tasks.filter((t) => taskIds.has(t.id) && t.isDraft !== true);
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
        </div>
      </div>

      {/* Pierwsza karta: dane podstawowe (awatar + imię/nazwisko/stanowisko/dział/spółka). */}
      <div className="editor-section profile-basics">
        <div className="profile-basics-main">
          {canUploadPhoto ? (
            <ProfilePhotoAvatar
              person={person}
              isSelf={isOwn}
              sessionUserId={auth.state.session?.user?.id ?? null}
            />
          ) : (
            <div className="profile-avatar-block">
              <Avatar person={person} size={72} />
            </div>
          )}
          <div className="profile-basics-fields">
            <div className="field-row">
              <div className="field">
                <label htmlFor="pp-first">Imię{allow('firstName') ? ' *' : ''}</label>
                {allow('firstName') ? (
                  <input
                    id="pp-first"
                    value={draft.firstName}
                    onChange={(e) => set('firstName', e.target.value)}
                  />
                ) : (
                  <div className="field-readonly">{person.firstName || '—'}</div>
                )}
              </div>
              <div className="field">
                <label htmlFor="pp-last">Nazwisko</label>
                {allow('lastName') ? (
                  <input
                    id="pp-last"
                    value={draft.lastName}
                    onChange={(e) => set('lastName', e.target.value)}
                  />
                ) : (
                  <div className="field-readonly">{person.lastName || '—'}</div>
                )}
              </div>
              <div className="field">
                <label htmlFor="pp-role">Stanowisko</label>
                {allow('roleTitle') ? (
                  <select
                    id="pp-role"
                    value={draft.role}
                    onChange={(e) =>
                      e.target.value === NEW_OPTION_VALUE
                        ? setQuickAdd('jobTitle')
                        : set('role', e.target.value)
                    }
                  >
                    <option value="">—</option>
                    {jobTitleSelectOptions(state.jobTitles, state.departments, draft.role).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value={NEW_OPTION_VALUE}>+ Nowe stanowisko…</option>
                  </select>
                ) : (
                  <div className="field-readonly">{person.role || '—'}</div>
                )}
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="pp-dep">Dział</label>
                {allow('departmentId') ? (
                  <select
                    id="pp-dep"
                    value={draft.departmentId}
                    onChange={(e) =>
                      e.target.value === NEW_OPTION_VALUE
                        ? setQuickAdd('department')
                        : set('departmentId', e.target.value)
                    }
                  >
                    <option value="">—</option>
                    {state.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                    <option value={NEW_OPTION_VALUE}>+ Nowy dział…</option>
                  </select>
                ) : (
                  <div className="field-readonly">
                    {getDepartment(state, person.departmentId)?.name || '—'}
                  </div>
                )}
              </div>
              <div className="field">
                <label htmlFor="pp-company">Spółka</label>
                {allow('companyId') ? (
                  <select
                    id="pp-company"
                    value={draft.companyId}
                    onChange={(e) =>
                      e.target.value === NEW_OPTION_VALUE
                        ? setQuickAdd('company')
                        : set('companyId', e.target.value)
                    }
                  >
                    <option value="">—</option>
                    {state.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value={NEW_OPTION_VALUE}>+ Nowa spółka…</option>
                  </select>
                ) : (
                  <div className="field-readonly">
                    {state.companies.find((c) => c.id === person.companyId)?.name || '—'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Kolejna sekcja tego samego panelu: pozostałe pola (input-albo-tekst).
          Pole „Uprawnienia" celowo NIEobecne (2026-07-22): wszyscy mają rolę
          „pelne", a draft.accessRole przenosi zapisaną wartość bez zmian. */}
      <div className="editor-section">
        <h2>Szczegóły</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pp-email">E-mail</label>
            {allow('email') ? (
              <input
                id="pp-email"
                type="email"
                value={draft.email}
                onChange={(e) => set('email', e.target.value)}
              />
            ) : person.email ? (
              <div className="field-readonly">
                <a href={`mailto:${person.email}`} className="profile-link">
                  {person.email}
                </a>
              </div>
            ) : (
              <div className="field-readonly">—</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="pp-phone">Telefon</label>
            {allow('phone') ? (
              <input
                id="pp-phone"
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="opcjonalnie"
              />
            ) : person.phone ? (
              <div className="field-readonly">
                <a href={`tel:${person.phone.replace(/\s+/g, '')}`} className="profile-link">
                  {person.phone}
                </a>
              </div>
            ) : (
              <div className="field-readonly">—</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="pp-birth">Data urodzenia</label>
            {allow('birthDate') ? (
              <input
                id="pp-birth"
                type="date"
                value={draft.birthDate}
                onChange={(e) => set('birthDate', e.target.value)}
              />
            ) : (
              <div className="field-readonly">
                {person.birthDate ? `🎂 ${formatBirthday(person.birthDate)}` : '—'}
              </div>
            )}
          </div>
        </div>
        <div className="field-row">
          <div className="field field-narrow">
            <label htmlFor="pp-avatar">Avatar</label>
            {allow('avatarEmoji') ? (
              <input
                id="pp-avatar"
                value={draft.avatar}
                onChange={(e) => set('avatar', e.target.value)}
                maxLength={4}
                placeholder="🙂"
              />
            ) : (
              <div className="field-readonly">{person.avatar || '—'}</div>
            )}
          </div>
          <div className="field">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={draft.emailNotifications === true}
                onChange={(e) => set('emailNotifications', e.target.checked)}
                disabled={!allow('emailNotifications')}
              />
              <span>Powiadomienia mailowe</span>
            </label>
          </div>
          <div className="field field-narrow">
            <label htmlFor="pp-cap">Godziny/dzień</label>
            {allow('capacity') ? (
              <input
                id="pp-cap"
                type="number"
                min={1}
                max={24}
                step={0.5}
                value={draft.capacity}
                onChange={(e) => set('capacity', Number(e.target.value) || DEFAULT_CAPACITY)}
              />
            ) : (
              <div className="field-readonly">{formatDuration(person.capacity)}</div>
            )}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Dni robocze</label>
            {allow('workDays') ? (
              <div className="weekday-chips" role="group" aria-label="Dni robocze">
                {WEEKDAY_CHIPS.map((c) => (
                  <label
                    key={c.iso}
                    className={`weekday-chip${draft.workDays.includes(c.iso) ? ' on' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={draft.workDays.includes(c.iso)}
                      onChange={() => set('workDays', toggleWorkDay(draft.workDays, c.iso))}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="field-readonly">{formatWorkDays(person.workDays)}</div>
            )}
          </div>
          {allow('workHours') ? (
            <>
              <div className="field field-narrow">
                <label htmlFor="pp-work-start">Praca od</label>
                <select
                  id="pp-work-start"
                  value={draft.workStartMinutes}
                  onChange={(e) => {
                    set('workStartMinutes', Number(e.target.value));
                    if (error) setError('');
                  }}
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
                >
                  {END_MINUTE_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {formatMinutes(m)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="field">
              <label>Godziny pracy</label>
              <div className="field-readonly">
                {formatMinutes(person.workStartMinutes)}–{formatMinutes(person.workEndMinutes)}
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="pp-supervisor">Przełożony</label>
            {allow('supervisorId') ? (
              <select
                id="pp-supervisor"
                value={draft.supervisorId}
                onChange={(e) => set('supervisorId', e.target.value)}
              >
                <option value="">—</option>
                {supervisorOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="field-readonly">
                {supervisor ? (
                  <Link to={`/people/${supervisor.id}`} className="profile-link">
                    {supervisor.name}
                  </Link>
                ) : (
                  '—'
                )}
              </div>
            )}
          </div>
        </div>
        {subordinates.length > 0 && (
          <div className="field">
            <label>Podwładni</label>
            <div className="field-readonly profile-fact-links">
              {subordinates.map((p, i) => (
                <span key={p.id}>
                  <Link to={`/people/${p.id}`} className="profile-link">
                    {p.name}
                  </Link>
                  {i < subordinates.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          </div>
        )}
        {canEdit && (
          <p className="field-hint">Limit dzienny liczony jest z pola dostępności.</p>
        )}
        {error && <p className="field-error">{error}</p>}
        {canEdit && (
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
        )}
      </div>

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
                    {formatShortWithWeekday(p.startDate)} – {formatShortWithWeekday(p.endDate)}
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
                    {formatShortWithWeekday(t.startDate)} – {formatShortWithWeekday(t.endDate)} ·{' '}
                    {formatDuration(taskPlannedTotalForPerson(state, t.id, person.id))} dla{' '}
                    {person.firstName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {quickAdd === 'jobTitle' && (
        <QuickAddModal
          title="Nowe stanowisko"
          label="Nazwa stanowiska *"
          placeholder="np. Specjalista SEO"
          validate={(n) =>
            state.jobTitles.some(
              (j) => j.name.trim().toLocaleLowerCase('pl-PL') === n.toLocaleLowerCase('pl-PL'),
            )
              ? 'Takie stanowisko już istnieje'
              : null
          }
          onSubmit={(n) => {
            dispatch({ type: 'ADD_JOB_TITLE', name: n });
            // Stanowisko osoby to wolny tekst — nowy wpis wybieramy od razu.
            set('role', n);
          }}
          onClose={() => setQuickAdd(null)}
        />
      )}
      {quickAdd === 'department' && (
        <QuickAddModal
          title="Nowy dział"
          label="Nazwa działu *"
          placeholder="np. Marketing"
          validate={(n) =>
            state.departments.some(
              (d) => d.name.trim().toLocaleLowerCase('pl-PL') === n.toLocaleLowerCase('pl-PL'),
            )
              ? 'Taki dział już istnieje'
              : null
          }
          onSubmit={(n) => {
            dispatch({ type: 'ADD_DEPARTMENT', name: n });
            setPendingDict({ kind: 'department', name: n });
          }}
          onClose={() => setQuickAdd(null)}
        />
      )}
      {quickAdd === 'company' && (
        <QuickAddModal
          title="Nowa spółka"
          label="Nazwa spółki *"
          placeholder="np. N2 Rental"
          validate={(n) =>
            state.companies.some(
              (c) => c.name.trim().toLocaleLowerCase('pl-PL') === n.toLocaleLowerCase('pl-PL'),
            )
              ? 'Taka spółka już istnieje'
              : null
          }
          onSubmit={(n) => {
            dispatch({ type: 'ADD_COMPANY', name: n });
            setPendingDict({ kind: 'company', name: n });
          }}
          onClose={() => setQuickAdd(null)}
        />
      )}
    </section>
  );
}

/**
 * Awatar w pierwszej karcie z bąbelkiem ołówka do zmiany zdjęcia (private-bucket,
 * tryb Supabase). Rodzic montuje ten komponent WYŁĄCZNIE gdy
 * `canUploadAvatarPhoto` jest true, więc w trybie lokalnym nigdy się nie montuje
 * (i nie dotyka klienta Supabase). Pobranie zawsze przez signed URL; błędy
 * degradują do inicjałów/emoji, nigdy nie blokują. Świeżo wgrane zdjęcie zasila
 * awatar pierwszej karty przez lokalny stan `photoUrl`.
 */
function ProfilePhotoAvatar({
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    <div className="profile-avatar-block">
      <div className="profile-avatar-wrap">
        <Avatar person={person} size={72} photoUrl={photoUrl ?? undefined} />
        {phase === 'ready' && (
          <button
            type="button"
            className="avatar-edit-bubble"
            aria-label="Zmień zdjęcie"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            ✎
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={busy}
          onChange={(e) => void onFile(e)}
          style={{ display: 'none' }}
        />
      </div>
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
        <p className="field-hint">Bez konta — zdjęcie po jego utworzeniu.</p>
      )}
      {phase === 'ready' && (
        <div className="profile-photo-actions">
          {busy && (
            <span className="field-hint" role="status">
              Wysyłanie…
            </span>
          )}
          {avatarPath && !busy && (
            <button
              type="button"
              className="avatar-remove-link"
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
      )}
    </div>
  );
}

/**
 * Password set/change/clear. Visible on your OWN profile or to anyone with
 * `people.manage` (rola `pelne`). Passwords are cosmetic client-side gating
 * (see utils/password.ts): min 4 chars, both fields must match, hashed BEFORE
 * dispatch (the reducer stays sync). Full-access users additionally get
 * `Usuń hasło` — the documented recovery path so a passwordless person can
 * always log in.
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
