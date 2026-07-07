// People: employee list + add form (first/last name, job title, department,
// avatar emoji, daily capacity, admin flag). Click a person for their profile.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { PersonDraft } from '../store/AppStore';
import { getDepartment, personTotalHours } from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { DEFAULT_CAPACITY } from '../store/storage';

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

const emptyDraft = (): PersonDraft => ({
  firstName: '',
  lastName: '',
  email: '',
  role: '',
  departmentId: '',
  avatar: '',
  capacity: DEFAULT_CAPACITY,
  isAdmin: false,
});

export function PeoplePage() {
  const { state, dispatch } = useStore();
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

      <form className="person-form" onSubmit={submit}>
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
        <label className="field-check">
          <input
            type="checkbox"
            checked={draft.isAdmin}
            onChange={(e) => set('isAdmin', e.target.checked)}
          />
          Administrator
        </label>
        <button type="submit" className="btn primary">
          Dodaj osobę
        </button>
        {error && <p className="field-error inline">{error}</p>}
      </form>

      {state.people.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak osób</p>
          <p className="empty-hint">Dodaj członków zespołu, żeby zacząć przypisywać pracę.</p>
        </div>
      ) : (
        <ul className="people-list">
          {state.people.map((p) => (
            <li key={p.id} className="person-row">
              <Avatar person={p} size={36} />
              <Link to={`/people/${p.id}`} className="person-row-main">
                <span className="person-row-name">
                  {p.name}
                  {p.isAdmin && <span className="admin-tag">administrator</span>}
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
              <span className="person-row-hours">
                przypisano {fmtHours(personTotalHours(state, p.id))}h
              </span>
              <button
                type="button"
                className="btn danger-ghost"
                onClick={() => remove(p.id, p.name)}
              >
                Usuń
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
