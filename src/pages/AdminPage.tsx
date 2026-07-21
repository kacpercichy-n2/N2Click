// Admin panel: pipeline statuses (create incl. "/name" quick command, rename,
// recolor, reorder, archive/restore, delete-when-unused), clients, departments,
// service types, and work categories. Only admins ("acting as" someone with the
// admin flag) may change anything here.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { allStatusesOrdered, isAdminUser } from '../store/selectors';
import { StatusBadge } from '../components/StatusBadge';
import { ExportDryRunPanel } from '../components/ExportDryRunPanel';
import { MigrationStatusPanel } from '../components/MigrationStatusPanel';
import { NavOrderEditor } from '../components/NavOrderEditor';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from '../supabase/OrgDataProvider';

// Lavender brand default for a freshly created status (dark-legible).
const NEW_STATUS_COLOR = '#c496ff';

export function AdminPage() {
  const { state, dispatch } = useStore();
  const { mode } = useAuth();
  const admin = isAdminUser(state);

  const [statusInput, setStatusInput] = useState('');
  const [statusColor, setStatusColor] = useState(NEW_STATUS_COLOR);
  const [depInput, setDepInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [companyInput, setCompanyInput] = useState('');
  const [svcInput, setSvcInput] = useState('');
  const [catInput, setCatInput] = useState('');

  if (!admin) {
    return (
      <section className="page">
        <div className="page-head">
          <h1>Ustawienia</h1>
        </div>
        <div className="empty-state">
          <p className="empty-title">Tylko dla adminów</p>
          <p className="empty-hint">
            Przełącz „Występuj jako” w nagłówku na osobę z uprawnieniami admina,
            aby zarządzać statusami, klientami, działami i typami usług.
          </p>
        </div>
      </section>
    );
  }

  const statuses = allStatusesOrdered(state);

  const statusInUse = (statusId: string) =>
    state.projects.some((p) => p.statusId === statusId) ||
    state.tasks.some((t) => t.statusId === statusId);

  // Mirror the reducer guards so the UI can pre-validate (the reducer silently
  // rejects violations). "Only active": archiving/deleting it leaves zero active
  // statuses. "Only done": no other status (active or archived) is `isDone`.
  const isOnlyActiveStatus = (statusId: string) => {
    const active = state.statuses.filter((s) => !s.archived);
    return active.length === 1 && active[0].id === statusId;
  };
  const isOnlyDoneStatus = (statusId: string) => {
    const done = state.statuses.filter((s) => s.isDone);
    return done.length === 1 && done[0].id === statusId;
  };

  const addStatus = (e: React.FormEvent) => {
    e.preventDefault();
    // Supports the "/status name" quick-create command form.
    const name = statusInput.replace(/^\//, '').trim();
    if (!name) return;
    dispatch({ type: 'SAVE_STATUS', statusId: null, name, color: statusColor });
    setStatusInput('');
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Ustawienia</h1>
      </div>

      <div className="editor-section" data-tour="admin.statuses">
        <h2>Statusy lejka</h2>
        <p className="field-hint">
          Statusy sterują kolumnami kanbana oraz statusem każdego projektu i zadania.
          Kolejność tutaj jest kolejnością w lejku. Zarchiwizowane statusy znikają
          z list wyboru, ale zachowują historię; usunięcie jest możliwe tylko, gdy status nie jest używany.
          Znacznik „Ukończenie” decyduje, które statusy oznaczają zakończoną pracę — kolejność w lejku nie ma na to wpływu.
        </p>
        <ul className="admin-status-list">
          {statuses.map((s, i) => {
            const onlyActive = isOnlyActiveStatus(s.id);
            const onlyDone = isOnlyDoneStatus(s.id);
            const inUse = statusInUse(s.id);
            const archiveDisabled = !s.archived && (onlyActive || onlyDone);
            const archiveTitle = archiveDisabled
              ? onlyActive
                ? 'Nie można zarchiwizować ostatniego aktywnego statusu.'
                : 'Nie można zarchiwizować jedynego statusu ukończenia — najpierw oznacz inny status.'
              : undefined;
            const deleteDisabled = inUse || onlyActive || onlyDone;
            const deleteTitle = inUse
              ? 'Używany przez projekty lub zadania — zamiast tego zarchiwizuj'
              : onlyActive
                ? 'Nie można usunąć ostatniego aktywnego statusu.'
                : onlyDone
                  ? 'Nie można usunąć jedynego statusu ukończenia.'
                  : undefined;
            return (
            <li key={s.id} className={s.archived ? 'admin-status archived' : 'admin-status'}>
              <input
                type="color"
                value={s.color}
                onChange={(e) =>
                  dispatch({ type: 'SAVE_STATUS', statusId: s.id, name: s.name, color: e.target.value })
                }
                aria-label={`Kolor statusu ${s.name}`}
              />
              <input
                className="admin-status-name"
                value={s.name}
                onChange={(e) =>
                  dispatch({ type: 'SAVE_STATUS', statusId: s.id, name: e.target.value, color: s.color })
                }
                aria-label={`Nazwa statusu ${s.name}`}
              />
              <code className="muted admin-status-slug">/{s.slug}</code>
              <StatusBadge status={s} />
              <label
                className="admin-status-done"
                data-tour="admin.done"
                title={
                  onlyDone
                    ? 'To jedyny status oznaczający ukończenie — najpierw oznacz inny status.'
                    : 'Projekty i zadania w tym statusie liczą się jako ukończone — niezależnie od kolejności w lejku.'
                }
              >
                <input
                  type="checkbox"
                  checked={s.isDone}
                  disabled={onlyDone}
                  onChange={() =>
                    dispatch({ type: 'SET_STATUS_DONE', statusId: s.id, isDone: !s.isDone })
                  }
                  aria-label={`Status „${s.name}” oznacza ukończenie`}
                />
                Ukończenie
              </label>
              <span className="admin-status-actions">
                <button
                  type="button"
                  className="nav-btn"
                  disabled={i === 0}
                  onClick={() => dispatch({ type: 'REORDER_STATUS', statusId: s.id, direction: -1 })}
                  aria-label={`Przesuń ${s.name} wcześniej`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  disabled={i === statuses.length - 1}
                  onClick={() => dispatch({ type: 'REORDER_STATUS', statusId: s.id, direction: 1 })}
                  aria-label={`Przesuń ${s.name} później`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={archiveDisabled}
                  title={archiveTitle}
                  onClick={() =>
                    dispatch({ type: 'SET_STATUS_ARCHIVED', statusId: s.id, archived: !s.archived })
                  }
                >
                  {s.archived ? 'Przywróć' : 'Archiwizuj'}
                </button>
                <button
                  type="button"
                  className="btn danger-ghost"
                  disabled={deleteDisabled}
                  title={deleteTitle}
                  onClick={() => dispatch({ type: 'DELETE_STATUS', statusId: s.id })}
                >
                  Usuń
                </button>
              </span>
            </li>
            );
          })}
        </ul>
        <form className="admin-add-form" onSubmit={addStatus}>
          <input
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value)}
            placeholder='Nowy status — spróbuj szybkiej komendy "/Akcept klienta"'
            aria-label="Nazwa nowego statusu"
          />
          <input
            type="color"
            value={statusColor}
            onChange={(e) => setStatusColor(e.target.value)}
            aria-label="Kolor nowego statusu"
          />
          <button type="submit" className="btn primary" disabled={!statusInput.replace(/^\//, '').trim()}>
            Dodaj status
          </button>
        </form>
      </div>

      <div className="editor-section" data-tour="admin.dictionaries">
        <h2>Klienci</h2>
        <SimpleList
          items={state.clients.map((c) => ({ id: c.id, name: c.name }))}
          onRename={(id, name) => dispatch({ type: 'RENAME_CLIENT', clientId: id, name })}
          onDelete={(id, name) => {
            const count = state.projects.filter((p) => p.clientId === id).length;
            if (
              window.confirm(
                `Usunąć klienta „${name}”?${count > 0 ? ` To usunie też jego projekty (${count}) wraz ze wszystkimi zadaniami i zaplanowanymi godzinami.` : ''}`,
              )
            ) {
              dispatch({ type: 'DELETE_CLIENT', clientId: id });
            }
          }}
        />
        {/* Nowy klient wymaga danych kontaktowych (osoba + e-mail lub telefon),
            więc szybkie dodawanie „po samej nazwie” zostało tu wyłączone —
            reduktor i tak by je odrzucił. Pełny formularz jest w module Klienci. */}
        <p className="field-hint">
          Nowego klienta dodasz w zakładce <Link to="/clients">Klienci</Link> — wymaga
          osoby kontaktowej oraz e-maila lub telefonu.
        </p>
      </div>

      <div className="editor-section">
        <h2>Działy</h2>
        <SimpleList
          items={state.departments}
          onRename={(id, name) => dispatch({ type: 'RENAME_DEPARTMENT', departmentId: id, name })}
          onDelete={(id, name) => {
            if (window.confirm(`Usunąć dział „${name}”? Osoby i projekty stracą tę etykietę.`)) {
              dispatch({ type: 'DELETE_DEPARTMENT', departmentId: id });
            }
          }}
        />
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!depInput.trim()) return;
            dispatch({ type: 'ADD_DEPARTMENT', name: depInput });
            setDepInput('');
          }}
        >
          <input
            value={depInput}
            onChange={(e) => setDepInput(e.target.value)}
            placeholder="Nazwa nowego działu"
            aria-label="Nazwa nowego działu"
          />
          <button type="submit" className="btn primary" disabled={!depInput.trim()}>
            Dodaj dział
          </button>
        </form>
      </div>

      <div className="editor-section">
        <h2>Spółki</h2>
        <SimpleList
          items={state.companies}
          onRename={(id, name) => dispatch({ type: 'RENAME_COMPANY', companyId: id, name })}
          onDelete={(id, name) => {
            if (
              window.confirm(
                `Usunąć spółkę „${name}”? Osoby stracą przypisanie do spółki, a widoczność projektów w chmurze przestanie być nią zawężana.`,
              )
            ) {
              dispatch({ type: 'DELETE_COMPANY', companyId: id });
            }
          }}
        />
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!companyInput.trim()) return;
            dispatch({ type: 'ADD_COMPANY', name: companyInput });
            setCompanyInput('');
          }}
        >
          <input
            value={companyInput}
            onChange={(e) => setCompanyInput(e.target.value)}
            placeholder="Nazwa nowej spółki"
            aria-label="Nazwa nowej spółki"
          />
          <button type="submit" className="btn primary" disabled={!companyInput.trim()}>
            Dodaj spółkę
          </button>
        </form>
        <p className="field-hint">
          Spółka przypisana osobie zawęża w chmurze widoczność projektów do jej
          spółki. Osoby bez spółki widzą dokładnie to co dotychczas.
        </p>
      </div>

      <div className="editor-section">
        <h2>Stanowiska</h2>
        <SimpleList
          items={state.jobTitles}
          onRename={(id, name) => dispatch({ type: 'RENAME_JOB_TITLE', jobTitleId: id, name })}
          onDelete={(id, name) => {
            if (
              window.confirm(
                `Usunąć stanowisko „${name}”? Osoby zachowają dotychczasowy wpis w profilu.`,
              )
            ) {
              dispatch({ type: 'DELETE_JOB_TITLE', jobTitleId: id });
            }
          }}
        />
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!titleInput.trim()) return;
            dispatch({ type: 'ADD_JOB_TITLE', name: titleInput });
            setTitleInput('');
          }}
        >
          <input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Nazwa nowego stanowiska"
            aria-label="Nazwa nowego stanowiska"
          />
          <button type="submit" className="btn primary" disabled={!titleInput.trim()}>
            Dodaj stanowisko
          </button>
        </form>
        <p className="field-hint">
          Stanowiska z tej listy pojawiają się w profilu osoby obok propozycji
          wyprowadzonych z działów.
        </p>
      </div>

      <div className="editor-section">
        <h2>Typy usług</h2>
        <SimpleList
          items={state.serviceTypes}
          onRename={(id, name) =>
            dispatch({ type: 'RENAME_SERVICE_TYPE', serviceTypeId: id, name })
          }
          onDelete={(id, name) => {
            if (window.confirm(`Usunąć typ usługi „${name}”? Projekty stracą tę etykietę.`)) {
              dispatch({ type: 'DELETE_SERVICE_TYPE', serviceTypeId: id });
            }
          }}
        />
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!svcInput.trim()) return;
            dispatch({ type: 'ADD_SERVICE_TYPE', name: svcInput });
            setSvcInput('');
          }}
        >
          <input
            value={svcInput}
            onChange={(e) => setSvcInput(e.target.value)}
            placeholder="Nazwa nowego typu usługi"
            aria-label="Nazwa nowego typu usługi"
          />
          <button type="submit" className="btn primary" disabled={!svcInput.trim()}>
            Dodaj typ usługi
          </button>
        </form>
      </div>

      <div className="editor-section">
        <h2>Kategorie prac</h2>
        <SimpleList
          items={state.workCategories}
          onRename={(id, name) =>
            dispatch({ type: 'RENAME_WORK_CATEGORY', workCategoryId: id, name })
          }
          onDelete={(id, name) => {
            if (window.confirm(`Usunąć kategorię „${name}”? Zadania stracą tę etykietę.`)) {
              dispatch({ type: 'DELETE_WORK_CATEGORY', workCategoryId: id });
            }
          }}
        />
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!catInput.trim()) return;
            dispatch({ type: 'ADD_WORK_CATEGORY', name: catInput });
            setCatInput('');
          }}
        >
          <input
            value={catInput}
            onChange={(e) => setCatInput(e.target.value)}
            placeholder="Nazwa nowej kategorii prac"
            aria-label="Nazwa nowej kategorii prac"
          />
          <button type="submit" className="btn primary" disabled={!catInput.trim()}>
            Dodaj kategorię
          </button>
        </form>
      </div>

      {mode === 'supabase' && <CloudDictionaries />}

      <NavOrderEditor />

      <ExportDryRunPanel />

      <MigrationStatusPanel />
    </section>
  );
}

/**
 * Read-only podgląd słowników w chmurze (tryb supabase): statusy, typy usług i
 * kategorie prac wczytane RLS-owo przez OrgDataProvider. Planer NADAL korzysta z
 * lokalnych słowników powyżej — te dane są tylko do wglądu do czasu migracji
 * danych. Stany ładowania/błędu/pustki po polsku.
 */
function CloudDictionaries() {
  const { state, reload } = useOrgData();

  return (
    <div className="editor-section">
      <h2>Słowniki w chmurze</h2>
      <p className="field-hint">
        Podgląd tylko do odczytu. Planer nadal używa lokalnych słowników powyżej —
        dane z chmury służą do porównania do czasu migracji danych.
      </p>

      {state.status === 'idle' || state.status === 'loading' ? (
        <p className="field-hint">Wczytywanie słowników…</p>
      ) : state.status === 'error' ? (
        <>
          <p className="field-error">{state.message}</p>
          <button type="button" className="btn ghost" onClick={reload}>
            Spróbuj ponownie
          </button>
        </>
      ) : (
        <div className="cloud-dictionaries">
          <h3>Statusy</h3>
          {state.snapshot.statuses.length === 0 ? (
            <p className="field-hint">Brak statusów w chmurze.</p>
          ) : (
            <ul className="admin-simple-list">
              {state.snapshot.statuses.map((s) => (
                <li key={s.id} className="admin-simple-row">
                  <span>{s.name}</span>
                  <span className="muted">
                    {s.isDone ? 'ukończenie' : 'aktywny'}
                    {s.archived ? ', zarchiwizowany' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3>Typy usług</h3>
          {state.snapshot.serviceTypes.length === 0 ? (
            <p className="field-hint">Brak typów usług w chmurze.</p>
          ) : (
            <ul className="admin-simple-list">
              {state.snapshot.serviceTypes.map((s) => (
                <li key={s.id} className="admin-simple-row">
                  <span>{s.name}</span>
                </li>
              ))}
            </ul>
          )}

          <h3>Kategorie prac</h3>
          {state.snapshot.workCategories.length === 0 ? (
            <p className="field-hint">Brak kategorii prac w chmurze.</p>
          ) : (
            <ul className="admin-simple-list">
              {state.snapshot.workCategories.map((c) => (
                <li key={c.id} className="admin-simple-row">
                  <span>{c.name}</span>
                </li>
              ))}
            </ul>
          )}

          <h3>Stanowiska</h3>
          {state.snapshot.jobTitles.length === 0 ? (
            <p className="field-hint">Brak stanowisk w chmurze.</p>
          ) : (
            <ul className="admin-simple-list">
              {state.snapshot.jobTitles.map((j) => (
                <li key={j.id} className="admin-simple-row">
                  <span>{j.name}</span>
                </li>
              ))}
            </ul>
          )}

          <h3>Spółki</h3>
          {state.snapshot.companies.length === 0 ? (
            <p className="field-hint">Brak spółek w chmurze.</p>
          ) : (
            <ul className="admin-simple-list">
              {state.snapshot.companies.map((c) => (
                <li key={c.id} className="admin-simple-row">
                  <span>{c.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// One editable dictionary row. Holds a LOCAL draft so the user can freely clear
// and retype the name; the store is only written on commit (blur / Enter), never
// per keystroke. Committing an empty/whitespace value reverts the field to the
// current store name (the reducer would reject it anyway). The row is keyed by
// `${item.id}:${item.name}` in SimpleList, so any external store rename remounts
// it and reseeds the draft from the fresh name.
function SimpleListRow({
  item,
  onRename,
  onDelete,
}: {
  item: { id: string; name: string };
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [draft, setDraft] = useState(item.name);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(item.name); // empty/whitespace rejected by the reducer — revert
      return;
    }
    if (trimmed !== item.name) onRename(item.id, trimmed);
    setDraft(trimmed); // normalize the visible value (drop stray whitespace)
  };

  return (
    <li className="admin-simple-row">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur(); // Enter commits via the blur handler
          }
        }}
        aria-label={`Zmień nazwę ${item.name}`}
      />
      <button
        type="button"
        className="btn danger-ghost"
        onClick={() => onDelete(item.id, item.name)}
      >
        Usuń
      </button>
    </li>
  );
}

function SimpleList({
  items,
  onRename,
  onDelete,
}: {
  items: Array<{ id: string; name: string }>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (items.length === 0) return <p className="field-hint">Na razie brak.</p>;
  return (
    <ul className="admin-simple-list">
      {items.map((item) => (
        // Key includes the store name so an external rename remounts the row and
        // reseeds its local draft from the fresh value.
        <SimpleListRow
          key={`${item.id}:${item.name}`}
          item={item}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}
