// Klienci: lista z danymi kontaktowymi, formularz dodawania, edycja inline,
// archiwizacja i usuwanie (kaskadowe — patrz DELETE_CLIENT w reduktorze).
// Uprawnienie `clients.manage` steruje edycją; podgląd ma każdy, kto widzi
// nawigację (jak Projekty).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePersistence, useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { Client } from '../types';
import { ChevronRight, Plus } from '../components/icons';
import { useAutoSave } from '../utils/useAutoSave';

function polishCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

interface ClientDraft {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
}

const emptyDraft = (): ClientDraft => ({
  name: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  notes: '',
});

const draftOf = (c: Client): ClientDraft => ({
  name: c.name,
  contactName: c.contactName ?? '',
  contactEmail: c.contactEmail ?? '',
  contactPhone: c.contactPhone ?? '',
  notes: c.notes ?? '',
});

/** Pola kontaktowe draftu (bez nazwy) — wspólne dla formularza i edycji. */
function ContactFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: ClientDraft;
  onChange: (patch: Partial<ClientDraft>) => void;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-contact`}>Osoba kontaktowa</label>
        <input
          id={`${idPrefix}-contact`}
          value={draft.contactName}
          onChange={(e) => onChange({ contactName: e.target.value })}
          placeholder="np. Anna Nowak"
          maxLength={200}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-email`}>E-mail</label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          value={draft.contactEmail}
          onChange={(e) => onChange({ contactEmail: e.target.value })}
          placeholder="np. anna@firma.pl"
          maxLength={320}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-phone`}>Telefon</label>
        <input
          id={`${idPrefix}-phone`}
          type="tel"
          value={draft.contactPhone}
          onChange={(e) => onChange({ contactPhone: e.target.value })}
          placeholder="np. +48 600 100 200"
          maxLength={40}
        />
      </div>
      <div className="field field-wide">
        <label htmlFor={`${idPrefix}-notes`}>Notatki</label>
        <textarea
          id={`${idPrefix}-notes`}
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="np. ustalenia handlowe, preferencje"
          rows={2}
          maxLength={4000}
        />
      </div>
    </>
  );
}

export function ClientsPage() {
  const { state, dispatch } = useStore();
  const { external } = usePersistence();
  const canManage = useCan()('clients.manage');

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ClientDraft>(emptyDraft);
  const [createError, setCreateError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState<ClientDraft>(emptyDraft);
  const [editError, setEditError] = useState('');

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of state.projects) {
      counts.set(p.clientId, (counts.get(p.clientId) ?? 0) + 1);
    }
    return counts;
  }, [state.projects]);

  const clients = useMemo(
    () =>
      [...state.clients]
        .filter((c) => showArchived || !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    [state.clients, showArchived],
  );
  const archivedCount = state.clients.filter((c) => c.archived).length;

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) {
      setCreateError('Nazwa klienta jest wymagana');
      return;
    }
    dispatch({
      type: 'ADD_CLIENT',
      name: draft.name,
      contactName: draft.contactName,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
      notes: draft.notes,
    });
    setDraft(emptyDraft());
    setCreateError('');
    setCreating(false);
  };

  const startEdit = (c: Client) => {
    setEditingId(c.id);
    setEditDraft(draftOf(c));
    setEditError('');
  };

  const commitEdit = () => {
    if (editingId === '' || !editDraft.name.trim()) return;
    dispatch({
      type: 'SAVE_CLIENT',
      clientId: editingId,
      name: editDraft.name,
      contactName: editDraft.contactName,
      contactEmail: editDraft.contactEmail,
      contactPhone: editDraft.contactPhone,
      notes: editDraft.notes,
    });
  };

  // Auto-zapis edycji: ważny draft (niepusta nazwa) zapisuje się w tle po
  // pauzie w pisaniu; przycisk „Zamknij” tylko zwija formularz.
  const editedClient = state.clients.find((c) => c.id === editingId);
  const editDirty =
    editedClient !== undefined &&
    JSON.stringify(draftOf(editedClient)) !==
      JSON.stringify({
        ...editDraft,
        name: editDraft.name.trim(),
        contactName: editDraft.contactName.trim(),
        contactEmail: editDraft.contactEmail.trim(),
        contactPhone: editDraft.contactPhone.trim(),
        notes: editDraft.notes.trim(),
      });
  useAutoSave({
    // Jawny konflikt kart wstrzymuje auto-zapis (decyzja należy do banera).
    enabled: canManage && editingId !== '' && external !== 'conflict',
    dirty: editDirty,
    valid: editDraft.name.trim() !== '',
    signature: JSON.stringify(editDraft),
    save: commitEdit,
  });

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDraft.name.trim()) {
      setEditError('Nazwa klienta jest wymagana');
      return;
    }
    commitEdit();
    setEditingId('');
  };

  const remove = (c: Client) => {
    const count = projectCounts.get(c.id) ?? 0;
    const cascade =
      count > 0
        ? ` Usunie to także ${count} ${polishCount(count, 'projekt', 'projekty', 'projektów')} tego klienta wraz z zadaniami i godzinami.`
        : '';
    if (window.confirm(`Usunąć klienta „${c.name}”?${cascade}`)) {
      dispatch({ type: 'DELETE_CLIENT', clientId: c.id });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Klienci</h1>
        <div className="page-head-actions">
          {archivedCount > 0 && (
            <label className="field-inline">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />{' '}
              Pokaż zarchiwizowanych ({archivedCount})
            </label>
          )}
          {canManage && (
            <button
              type="button"
              className="btn primary"
              onClick={() => setCreating((v) => !v)}
            >
              <Plus size={16} aria-hidden /> Dodaj klienta
            </button>
          )}
        </div>
      </div>

      {canManage && creating && (
        <form className="client-create project-create" onSubmit={submitCreate}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="cl-name">Nazwa klienta *</label>
              <input
                id="cl-name"
                value={draft.name}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, name: e.target.value }));
                  if (createError) setCreateError('');
                }}
                placeholder="np. Acme Foods"
                maxLength={200}
              />
            </div>
            <ContactFields
              idPrefix="cl"
              draft={draft}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />
          </div>
          {createError && (
            <p className="field-error" role="alert">
              {createError}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn primary">
              Dodaj klienta
            </button>
            <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
              Anuluj
            </button>
          </div>
        </form>
      )}

      {clients.length === 0 ? (
        <p className="muted">
          Brak klientów.{' '}
          {canManage ? 'Dodaj pierwszego przyciskiem „Dodaj klienta”.' : ''}
        </p>
      ) : (
        <div className="client-list">
          {clients.map((c) => {
            const count = projectCounts.get(c.id) ?? 0;
            const editing = editingId === c.id;
            return (
              <div key={c.id} className={c.archived ? 'client-card archived' : 'client-card'}>
                {editing ? (
                  <form className="client-edit project-create" onSubmit={submitEdit}>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="cle-name">Nazwa klienta *</label>
                        <input
                          id="cle-name"
                          value={editDraft.name}
                          onChange={(e) => {
                            setEditDraft((d) => ({ ...d, name: e.target.value }));
                            if (editError) setEditError('');
                          }}
                          maxLength={200}
                        />
                      </div>
                      <ContactFields
                        idPrefix="cle"
                        draft={editDraft}
                        onChange={(patch) => setEditDraft((d) => ({ ...d, ...patch }))}
                      />
                    </div>
                    {editError && (
                      <p className="field-error" role="alert">
                        {editError}
                      </p>
                    )}
                    <div className="form-actions">
                      <span className="field-hint autosave-hint" role="status">
                        Zmiany zapisują się automatycznie.
                      </span>
                      <button type="submit" className="btn primary">
                        Zamknij
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="client-card-main">
                      <div className="client-card-title">
                        <strong>{c.name}</strong>
                        {c.archived && <span className="muted"> (zarchiwizowany)</span>}
                      </div>
                      <div className="client-card-meta muted">
                        {c.contactName && <span>{c.contactName}</span>}
                        {c.contactEmail && (
                          <a href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a>
                        )}
                        {c.contactPhone && (
                          <a href={`tel:${c.contactPhone}`}>{c.contactPhone}</a>
                        )}
                        {!c.contactName && !c.contactEmail && !c.contactPhone && (
                          <span>Brak danych kontaktowych</span>
                        )}
                      </div>
                      {c.notes && <p className="client-card-notes muted">{c.notes}</p>}
                    </div>
                    <div className="client-card-actions">
                      <Link className="btn ghost small" to={`/projects?client=${c.id}`}>
                        {count} {polishCount(count, 'projekt', 'projekty', 'projektów')}{' '}
                        <ChevronRight size={14} aria-hidden />
                      </Link>
                      {canManage && (
                        <>
                          <button type="button" className="btn ghost small" onClick={() => startEdit(c)}>
                            Edytuj
                          </button>
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              dispatch({
                                type: 'SET_CLIENT_ARCHIVED',
                                clientId: c.id,
                                archived: !c.archived,
                              })
                            }
                          >
                            {c.archived ? 'Przywróć' : 'Archiwizuj'}
                          </button>
                          <button
                            type="button"
                            className="btn danger-ghost small"
                            onClick={() => remove(c)}
                          >
                            Usuń
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
