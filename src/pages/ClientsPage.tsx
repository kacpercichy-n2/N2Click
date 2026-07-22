// Klienci: lista z rozwijanymi kartami (opis + dodatkowe osoby kontaktowe
// widoczne dopiero po rozwinięciu), formularz dodawania, edycja inline,
// archiwizacja i usuwanie (kaskadowe — patrz DELETE_CLIENT w reduktorze).
// Uprawnienie `clients.manage` steruje edycją; podgląd ma każdy, kto widzi
// nawigację (jak Projekty).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePersistence, useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { Client } from '../types';
import { ChevronRight, Plus, Trash2 } from '../components/icons';
import {
  clientDraftError,
  draftOf,
  draftToActionPayload,
  emptyDraft,
  joinContactName,
  newContactRow,
  normalizedDraft,
  type ClientFormDraft,
} from './clientContactForm';
import { useAutoSave } from '../utils/useAutoSave';

function polishCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

type DraftUpdater = (updater: (d: ClientFormDraft) => ClientFormDraft) => void;

/** Pola formularza klienta: nazwa, główna osoba kontaktowa, dodatkowe osoby i
 *  opis. Wspólne dla tworzenia i edycji. */
function ClientFormFields({
  idPrefix,
  draft,
  onDraft,
}: {
  idPrefix: string;
  draft: ClientFormDraft;
  onDraft: DraftUpdater;
}) {
  const setPrimary = (patch: Partial<ClientFormDraft['primary']>) =>
    onDraft((d) => ({ ...d, primary: { ...d.primary, ...patch } }));
  const setContact = (id: string, patch: Partial<ClientFormDraft['contacts'][number]>) =>
    onDraft((d) => ({
      ...d,
      contacts: d.contacts.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  const addContact = () => onDraft((d) => ({ ...d, contacts: [...d.contacts, newContactRow()] }));
  const removeContact = (id: string) =>
    onDraft((d) => ({ ...d, contacts: d.contacts.filter((r) => r.id !== id) }));

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-name`}>Nazwa klienta *</label>
          <input
            id={`${idPrefix}-name`}
            value={draft.name}
            onChange={(e) => onDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="np. Acme Foods"
            maxLength={200}
          />
        </div>
      </div>

      <fieldset className="client-contact-group">
        <legend>Główna osoba kontaktowa</legend>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${idPrefix}-first`}>Imię *</label>
            <input
              id={`${idPrefix}-first`}
              value={draft.primary.firstName}
              onChange={(e) => setPrimary({ firstName: e.target.value })}
              placeholder="np. Anna"
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-last`}>Nazwisko *</label>
            <input
              id={`${idPrefix}-last`}
              value={draft.primary.lastName}
              onChange={(e) => setPrimary({ lastName: e.target.value })}
              placeholder="np. Nowak"
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-phone`}>Telefon *</label>
            <input
              id={`${idPrefix}-phone`}
              type="tel"
              value={draft.primary.phone}
              onChange={(e) => setPrimary({ phone: e.target.value })}
              placeholder="np. +48 600 100 200"
              maxLength={40}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-email`}>E-mail *</label>
            <input
              id={`${idPrefix}-email`}
              type="email"
              value={draft.primary.email}
              onChange={(e) => setPrimary({ email: e.target.value })}
              placeholder="np. anna@firma.pl"
              maxLength={320}
            />
          </div>
        </div>
      </fieldset>

      {draft.contacts.map((row, i) => (
        <fieldset className="client-contact-group" key={row.id}>
          <legend>Dodatkowa osoba kontaktowa {i + 1}</legend>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${idPrefix}-c-${row.id}-first`}>Imię *</label>
              <input
                id={`${idPrefix}-c-${row.id}-first`}
                value={row.firstName}
                onChange={(e) => setContact(row.id, { firstName: e.target.value })}
                maxLength={100}
              />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-c-${row.id}-last`}>Nazwisko *</label>
              <input
                id={`${idPrefix}-c-${row.id}-last`}
                value={row.lastName}
                onChange={(e) => setContact(row.id, { lastName: e.target.value })}
                maxLength={100}
              />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-c-${row.id}-phone`}>Telefon</label>
              <input
                id={`${idPrefix}-c-${row.id}-phone`}
                type="tel"
                value={row.phone}
                onChange={(e) => setContact(row.id, { phone: e.target.value })}
                maxLength={40}
              />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-c-${row.id}-email`}>E-mail</label>
              <input
                id={`${idPrefix}-c-${row.id}-email`}
                type="email"
                value={row.email}
                onChange={(e) => setContact(row.id, { email: e.target.value })}
                maxLength={320}
              />
            </div>
            <button
              type="button"
              className="btn danger-ghost small client-contact-remove"
              onClick={() => removeContact(row.id)}
            >
              <Trash2 size={14} aria-hidden /> Usuń
            </button>
          </div>
        </fieldset>
      ))}

      <button type="button" className="btn ghost small client-contact-add" onClick={addContact}>
        <Plus size={14} aria-hidden /> Dodaj osobę kontaktową
      </button>

      <div className="field field-wide">
        <label htmlFor={`${idPrefix}-notes`}>Opis klienta</label>
        <textarea
          id={`${idPrefix}-notes`}
          value={draft.notes}
          onChange={(e) => onDraft((d) => ({ ...d, notes: e.target.value }))}
          placeholder="np. ustalenia handlowe, preferencje, historia współpracy"
          rows={3}
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
  const [draft, setDraft] = useState<ClientFormDraft>(emptyDraft);
  const [createError, setCreateError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState<ClientFormDraft>(emptyDraft);
  // Rozwinięta karta — pojedynczy akordeon, stan LOKALNY (nie trwały).
  const [expandedId, setExpandedId] = useState('');

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
    const error = clientDraftError(draft);
    if (error) {
      setCreateError(error);
      return;
    }
    dispatch({ type: 'ADD_CLIENT', ...draftToActionPayload(draft) });
    setDraft(emptyDraft());
    setCreateError('');
    setCreating(false);
  };

  const startEdit = (c: Client) => {
    setEditingId(c.id);
    setEditDraft(draftOf(c));
  };

  const commitEdit = () => {
    if (editingId === '' || clientDraftError(editDraft) !== '') return;
    dispatch({ type: 'SAVE_CLIENT', clientId: editingId, ...draftToActionPayload(editDraft) });
  };

  // Auto-zapis edycji: TYLKO draft spełniający regułę formularza (nazwa + pełna
  // główna osoba kontaktowa + poprawne dodatkowe osoby) zapisuje się w tle po
  // pauzie w pisaniu. Reguła formularza jest STRICTLY silniejsza od bramki
  // reduktora, więc żaden auto-zapis nie zostanie po cichu odrzucony i nie
  // pojawi się fałszywe „Zapisano”. Niepełny draft WSTRZYMUJE auto-zapis
  // (useAutoSave nie odpala `save`); przycisk „Zamknij” tylko zwija formularz.
  const editedClient = state.clients.find((c) => c.id === editingId);
  const editDirty =
    editedClient !== undefined && normalizedDraft(draftOf(editedClient)) !== normalizedDraft(editDraft);
  useAutoSave({
    // Jawny konflikt kart wstrzymuje auto-zapis (decyzja należy do banera).
    enabled: canManage && editingId !== '' && external !== 'conflict',
    dirty: editDirty,
    valid: clientDraftError(editDraft) === '',
    signature: JSON.stringify(editDraft),
    save: commitEdit,
  });

  // Komunikat edycji jest LIVE (nie tylko po „Zamknij”): auto-zapis milknie przy
  // niepoprawnym drafcie, więc powód musi być widoczny od razu. Znika sam, gdy
  // użytkownik uzupełni brakujące pole.
  const editError = editingId === '' ? '' : clientDraftError(editDraft);

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editError) return;
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

  const toggleExpanded = (id: string) => setExpandedId((cur) => (cur === id ? '' : id));

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
          <ClientFormFields
            idPrefix="cl"
            draft={draft}
            onDraft={(updater) => {
              setDraft(updater);
              if (createError) setCreateError('');
            }}
          />
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
            const expanded = expandedId === c.id;
            const extraCount = c.contacts?.length ?? 0;
            const detailsId = `client-details-${c.id}`;
            const handleMainClick = (e: React.MouseEvent) => {
              const target = e.target as HTMLElement;
              if (target.closest('a') || target.closest('button')) return;
              toggleExpanded(c.id);
            };
            return (
              <div key={c.id} className={c.archived ? 'client-card archived' : 'client-card'}>
                {editing ? (
                  <form className="client-edit project-create" onSubmit={submitEdit}>
                    <ClientFormFields idPrefix={`cle-${c.id}`} draft={editDraft} onDraft={setEditDraft} />
                    {editError && (
                      <p className="field-error" role="alert">
                        {editError}
                      </p>
                    )}
                    <div className="form-actions">
                      <span className="field-hint autosave-hint" role="status">
                        {editError
                          ? 'Auto-zapis wstrzymany do czasu uzupełnienia wymaganych pól.'
                          : 'Zmiany zapisują się automatycznie.'}
                      </span>
                      <button type="submit" className="btn primary">
                        Zamknij
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="client-card-main" onClick={handleMainClick}>
                      <button
                        type="button"
                        className={expanded ? 'client-card-toggle expanded' : 'client-card-toggle'}
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => toggleExpanded(c.id)}
                      >
                        <ChevronRight size={16} className="client-card-chevron" aria-hidden />
                        <strong>{c.name}</strong>
                        {c.archived && <span className="muted"> (zarchiwizowany)</span>}
                        {extraCount > 0 && (
                          <span className="client-contact-badge">
                            +{extraCount}{' '}
                            {polishCount(
                              extraCount,
                              'os. kontaktowa',
                              'os. kontaktowe',
                              'os. kontaktowych',
                            )}
                          </span>
                        )}
                      </button>
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
                      {expanded && (
                        <div className="client-card-details" id={detailsId}>
                          {!c.notes && extraCount === 0 ? (
                            <p className="muted">Brak dodatkowych informacji</p>
                          ) : (
                            <>
                              {c.notes && (
                                <div className="client-detail-section">
                                  <h4>Opis</h4>
                                  <p className="client-card-notes">{c.notes}</p>
                                </div>
                              )}
                              {extraCount > 0 && (
                                <div className="client-detail-section">
                                  <h4>Dodatkowe osoby kontaktowe</h4>
                                  <ul className="client-contact-list">
                                    {c.contacts!.map((k) => (
                                      <li key={k.id}>
                                        <span>{joinContactName(k.firstName, k.lastName)}</span>
                                        {k.phone && <a href={`tel:${k.phone}`}>{k.phone}</a>}
                                        {k.email && <a href={`mailto:${k.email}`}>{k.email}</a>}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
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
