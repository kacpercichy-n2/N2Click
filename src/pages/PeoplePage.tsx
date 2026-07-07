import { useState } from 'react';
import { useStore } from '../store/AppStore';
import { personTotalHours } from '../store/selectors';
import { personColor } from '../utils/colors';

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function PeoplePage() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    dispatch({
      type: 'ADD_PERSON',
      person: { name: trimmed, email: email.trim(), role: role.trim() },
    });
    setName('');
    setEmail('');
    setRole('');
    setError('');
  };

  const remove = (personId: string, personName: string) => {
    if (
      window.confirm(
        `Remove ${personName}? All their assignments and planned hours will be deleted.`,
      )
    ) {
      dispatch({ type: 'DELETE_PERSON', personId });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>People</h1>
      </div>

      <form className="person-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="p-name">Name *</label>
          <input
            id="p-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="e.g. Ola"
          />
        </div>
        <div className="field">
          <label htmlFor="p-email">Email</label>
          <input
            id="p-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div className="field">
          <label htmlFor="p-role">Role</label>
          <input
            id="p-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="optional"
          />
        </div>
        <button type="submit" className="btn primary">
          Add person
        </button>
        {error && <p className="field-error inline">{error}</p>}
      </form>

      {state.people.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No people yet</p>
          <p className="empty-hint">Add your team members to start assigning work.</p>
        </div>
      ) : (
        <ul className="people-list">
          {state.people.map((p) => (
            <li key={p.id} className="person-row">
              <span
                className="person-dot lg"
                style={{ background: personColor(p.id) }}
                aria-hidden
              />
              <div className="person-row-main">
                <span className="person-row-name">{p.name}</span>
                <span className="person-row-sub">
                  {p.role && <span className="person-row-role">{p.role}</span>}
                  {p.email && <span className="person-row-email">{p.email}</span>}
                </span>
              </div>
              <span className="person-row-hours">
                {fmtHours(personTotalHours(state, p.id))}h assigned
              </span>
              <button
                type="button"
                className="btn danger-ghost"
                onClick={() => remove(p.id, p.name)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
