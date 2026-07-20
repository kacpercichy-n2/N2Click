// Kartoteka klientów: pełny CRUD z opcjonalnymi danymi kontaktowymi (osoba
// kontaktowa, e-mail, telefon). Strona jest widoczna dla KAŻDEJ roli (klienci to
// dane referencyjne, SELECT jest otwarty); wszystkie przyciski mutujące bramkuje
// uprawnienie `clients.manage` (admin + handlowiec). To gate wyłącznie UX —
// granicą bezpieczeństwa pozostaje RLS Supabase (edycja handlowca w chmurze może
// zostać odrzucona po stronie serwera z polskim komunikatem — zaakceptowane).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { Client, ClientDraft } from '../types';
import { polishCount } from '../utils/polish';

export function ClientsPage() {
  const { state, dispatch } = useStore();
  const can = useCan();
  const canManage = can('clients.manage');
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Liczba projektów per klient (trywialne zliczenie inline).
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of state.projects) counts.set(p.clientId, (counts.get(p.clientId) ?? 0) + 1);
    return counts;
  }, [state.projects]);

  const active = state.clients.filter((c) => !c.archived);
  const archived = state.clients.filter((c) => c.archived);

  const confirmDelete = (client: Client) => {
    const count = projectCounts.get(client.id) ?? 0;
    if (
      window.confirm(
        `Usunąć klienta „${client.name}”?${count > 0 ? ` To usunie też jego projekty (${count}) wraz ze wszystkimi zadaniami i zaplanowanymi godzinami.` : ''}`,
      )
    ) {
      dispatch({ type: 'DELETE_CLIENT', clientId: client.id });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Klienci</h1>
        {canManage && (
          <button type="button" className="btn primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Zamknij' : '+ Nowy klient'}
          </button>
        )}
      </div>

      {canManage && creating && (
        <div className="editor-section">
          <h2>Nowy klient</h2>
          <ClientForm
            idPrefix="new"
            submitLabel="Utwórz klienta"
            onSubmit={(draft) => {
              dispatch({ type: 'SAVE_CLIENT', clientId: null, draft });
              setCreating(false);
            }}
          />
        </div>
      )}

      <div className="editor-section">
        <h2>Aktywni klienci</h2>
        {active.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">Brak klientów</p>
            <p className="empty-hint">
              {canManage
                ? 'Dodaj klienta, aby grupować pod nim projekty i przechowywać dane kontaktowe.'
                : 'Nie masz jeszcze żadnych klientów.'}
            </p>
          </div>
        ) : (
          <ul className="clients-list">
            {active.map((c) => (
              <ClientRow
                key={c.id}
                client={c}
                projectCount={projectCounts.get(c.id) ?? 0}
                canManage={canManage}
                onSave={(draft) => dispatch({ type: 'SAVE_CLIENT', clientId: c.id, draft })}
                onArchive={() =>
                  dispatch({ type: 'SET_CLIENT_ARCHIVED', clientId: c.id, archived: true })
                }
                onDelete={() => confirmDelete(c)}
              />
            ))}
          </ul>
        )}
      </div>

      {archived.length > 0 && (
        <div className="editor-section">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
          >
            {showArchived ? 'Ukryj' : 'Pokaż'} zarchiwizowanych klientów ({archived.length})
          </button>
          {showArchived && (
            <ul className="clients-list archived">
              {archived.map((c) => (
                <ClientRow
                  key={c.id}
                  client={c}
                  projectCount={projectCounts.get(c.id) ?? 0}
                  canManage={canManage}
                  archivedView
                  onRestore={() =>
                    dispatch({ type: 'SET_CLIENT_ARCHIVED', clientId: c.id, archived: false })
                  }
                  onDelete={() => confirmDelete(c)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface ClientRowProps {
  client: Client;
  projectCount: number;
  canManage: boolean;
  archivedView?: boolean;
  onSave?: (draft: ClientDraft) => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}

function ClientRow({
  client,
  projectCount,
  canManage,
  archivedView,
  onSave,
  onArchive,
  onRestore,
  onDelete,
}: ClientRowProps) {
  const [editing, setEditing] = useState(false);

  if (editing && onSave) {
    return (
      <li className="client-row editing">
        <ClientForm
          idPrefix={client.id}
          initial={client}
          submitLabel="Zapisz zmiany"
          onCancel={() => setEditing(false)}
          onSubmit={(draft) => {
            onSave(draft);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={archivedView ? 'client-row archived' : 'client-row'}>
      <div className="client-row-info">
        <span className="client-row-name">{client.name}</span>
        <span className="client-row-meta muted">
          <Link to={`/projects?client=${client.id}`}>
            {projectCount} {polishCount(projectCount, 'projekt', 'projekty', 'projektów')}
          </Link>
        </span>
        {(client.contactPerson || client.email || client.phone) && (
          <span className="client-row-contact muted">
            {[client.contactPerson, client.email, client.phone].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {canManage && (
        <div className="client-row-actions">
          {archivedView ? (
            <button type="button" className="btn soft" onClick={onRestore}>
              Przywróć
            </button>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={() => setEditing(true)}>
                Edytuj
              </button>
              <button type="button" className="btn ghost" onClick={onArchive}>
                Archiwizuj
              </button>
            </>
          )}
          <button type="button" className="btn danger-ghost" onClick={onDelete}>
            Usuń
          </button>
        </div>
      )}
    </li>
  );
}

interface ClientFormProps {
  // Unique per form instance so simultaneously-open forms (create + one or more
  // inline row edits) never collide on input/label DOM ids.
  idPrefix: string;
  initial?: Client;
  submitLabel: string;
  onSubmit: (draft: ClientDraft) => void;
  onCancel?: () => void;
}

function ClientForm({ idPrefix, initial, submitLabel, onSubmit, onCancel }: ClientFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nazwa klienta jest wymagana');
      return;
    }
    onSubmit({ name, contactPerson, email, phone });
    setError('');
  };

  return (
    <form className="client-form" onSubmit={submit}>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`cl-${idPrefix}-name`}>Nazwa klienta *</label>
          <input
            id={`cl-${idPrefix}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Acme Foods"
          />
        </div>
        <div className="field">
          <label htmlFor={`cl-${idPrefix}-contact`}>Osoba kontaktowa</label>
          <input
            id={`cl-${idPrefix}-contact`}
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="np. Anna Kowalska"
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`cl-${idPrefix}-email`}>E-mail</label>
          <input
            id={`cl-${idPrefix}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="np. kontakt@acme.pl"
          />
        </div>
        <div className="field">
          <label htmlFor={`cl-${idPrefix}-phone`}>Telefon</label>
          <input
            id={`cl-${idPrefix}-phone`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="np. +48 600 100 200"
          />
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="editor-actions">
        <button type="submit" className="btn primary">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Anuluj
          </button>
        )}
      </div>
    </form>
  );
}
