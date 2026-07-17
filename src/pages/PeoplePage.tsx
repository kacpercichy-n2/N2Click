// People: employee list + add form (first/last name, job title, department,
// avatar emoji, daily capacity, admin flag). Click a person for their profile.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import { useCan } from '../store/useCan';
import type { PersonDraft } from '../store/AppStore';
import { getDepartment, personTotalHours } from '../store/selectors';
import { ROLE_LABELS } from '../store/permissions';
import type { AccessRole } from '../types';
import { Avatar } from '../components/Avatar';
import { ChevronRight } from '../components/icons';
import { DEFAULT_CAPACITY, defaultWorkEndMinutes } from '../store/storage';
import { formatDuration, formatMinutes } from '../utils/time';
import {
  END_MINUTE_OPTIONS,
  START_MINUTE_OPTIONS,
  WEEKDAY_CHIPS,
  toggleWorkDay,
} from '../components/personFields';

const emptyDraft = (): PersonDraft => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: '',
  departmentId: '',
  avatar: '',
  capacity: DEFAULT_CAPACITY,
  accessRole: 'pracownik',
  workDays: [1, 2, 3, 4, 5],
  workStartMinutes: 480,
  workEndMinutes: defaultWorkEndMinutes(DEFAULT_CAPACITY),
  supervisorId: '',
});

export function PeoplePage() {
  const { state, dispatch } = useStore();
  const auth = useAuth();
  // W trybie supabase konta żyją w chmurze: tworzenie idzie przez provisioning
  // (Zespół → Utwórz konto na /team), a usuwanie przez operatora w panelu
  // Supabase. Lokalny formularz dodawania i przycisk Usuń tworzyłyby wiersze,
  // które najbliższa autorytatywna hydracja i tak by wymiotła — ukrywamy je.
  const cloudAccounts = auth.mode === 'supabase';
  const canManageRaw = useCan()('people.manage');
  const canManage = canManageRaw && !cloudAccounts;
  const [draft, setDraft] = useState<PersonDraft>(emptyDraft);
  const [error, setError] = useState('');

  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.firstName.trim()) {
      setError('Imię jest wymagane');
      return;
    }
    if (draft.workEndMinutes <= draft.workStartMinutes) {
      setError('Koniec pracy musi być po początku');
      return;
    }
    dispatch({ type: 'ADD_PERSON', person: draft });
    setDraft(emptyDraft());
    setError('');
  };

  const remove = (personId: string, personName: string) => {
    if (
      window.confirm(
        `Usunąć ${personName}? Wszystkie przypisania i zaplanowane godziny tej osoby zostaną usunięte.`,
      )
    ) {
      dispatch({ type: 'DELETE_PERSON', personId });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Zespół</h1>
      </div>

      {cloudAccounts && canManageRaw && (
        <p className="field-hint people-form-hint">
          Konta zespołu żyją na serwerze. Nowe konto założysz w{' '}
          <Link to="/team">Zespół → Utwórz konto</Link>; edycja profilu działa na
          stronie osoby, a usuwanie kont wykonuje administrator w panelu Supabase.
        </p>
      )}

      {canManage && (
      <form className="person-form" onSubmit={submit} data-tour="people.capacity">
        <div className="field">
          <label htmlFor="p-first">Imię *</label>
          <input
            id="p-first"
            value={draft.firstName}
            onChange={(e) => {
              set('firstName', e.target.value);
              if (error) setError('');
            }}
            placeholder="np. Ola"
          />
        </div>
        <div className="field">
          <label htmlFor="p-last">Nazwisko</label>
          <input
            id="p-last"
            value={draft.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            placeholder="opcjonalnie"
          />
        </div>
        <div className="field">
          <label htmlFor="p-role">Stanowisko</label>
          <input
            id="p-role"
            value={draft.role}
            onChange={(e) => set('role', e.target.value)}
            placeholder="np. Projektantka"
          />
        </div>
        <div className="field">
          <label htmlFor="p-dep">Dział</label>
          <select
            id="p-dep"
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
        <div className="field">
          <label htmlFor="p-email">Email</label>
          <input
            id="p-email"
            type="email"
            value={draft.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="opcjonalnie"
          />
        </div>
        <div className="field">
          <label htmlFor="p-phone">Telefon</label>
          <input
            id="p-phone"
            value={draft.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="opcjonalnie"
          />
        </div>
        <div className="field field-narrow">
          <label htmlFor="p-avatar">Avatar</label>
          <input
            id="p-avatar"
            value={draft.avatar}
            onChange={(e) => set('avatar', e.target.value)}
            placeholder="🙂"
            maxLength={4}
          />
        </div>
        <div className="field field-narrow">
          <label htmlFor="p-cap">Godziny/dzień</label>
          <input
            id="p-cap"
            type="number"
            min={1}
            max={24}
            step={0.5}
            value={draft.capacity}
            onChange={(e) => set('capacity', Number(e.target.value) || DEFAULT_CAPACITY)}
          />
        </div>
        <div className="field field-narrow">
          <label htmlFor="p-role-access">Uprawnienia</label>
          <select
            id="p-role-access"
            value={draft.accessRole}
            onChange={(e) => set('accessRole', e.target.value as AccessRole)}
          >
            {(Object.keys(ROLE_LABELS) as AccessRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Dni robocze</label>
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
        </div>
        <div className="field field-narrow">
          <label htmlFor="p-work-start">Praca od</label>
          <select
            id="p-work-start"
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
          <label htmlFor="p-work-end">Praca do</label>
          <select
            id="p-work-end"
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
        <div className="field">
          <label htmlFor="p-supervisor">Przełożony</label>
          <select
            id="p-supervisor"
            value={draft.supervisorId}
            onChange={(e) => set('supervisorId', e.target.value)}
          >
            <option value="">—</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <p className="field-hint people-form-hint">
          Limit dzienny liczony jest z pola dostępności.
        </p>
        <button type="submit" className="btn primary">
          Dodaj osobę
        </button>
        {error && <p className="field-error inline">{error}</p>}
      </form>
      )}

      {state.people.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak osób</p>
          <p className="empty-hint">Dodaj członków zespołu, żeby zacząć przypisywać pracę.</p>
        </div>
      ) : (
        <ul className="people-list" data-tour="people.list">
          {state.people.map((p) => (
            <li key={p.id} className="person-row">
              <Avatar person={p} size={36} />
              <Link to={`/people/${p.id}`} className="person-row-main">
                <span className="person-row-name">
                  {p.name}
                  {p.accessRole === 'administrator' && (
                    <span className="admin-tag">administrator</span>
                  )}
                </span>
                <span className="person-row-sub">
                  {p.role && <span className="person-row-role">{p.role}</span>}
                  {p.departmentId && (
                    <span className="person-row-role">
                      {getDepartment(state, p.departmentId)?.name}
                    </span>
                  )}
                  {p.email && <span className="person-row-email">{p.email}</span>}
                </span>
              </Link>
              <ChevronRight className="card-chevron" size={16} aria-hidden />
              <span className="person-row-hours">
                przypisano {formatDuration(personTotalHours(state, p.id))}
              </span>
              {canManage && (
                <button
                  type="button"
                  className="btn danger-ghost"
                  onClick={() => remove(p.id, p.name)}
                >
                  Usuń
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
