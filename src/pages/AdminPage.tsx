// Admin panel: pipeline statuses (create incl. "/name" quick command, rename,
// recolor, reorder, archive/restore, delete-when-unused), clients, departments,
// service types, and work categories. Only admins ("acting as" someone with the
// admin flag) may change anything here.
import { useState } from 'react';
import { useStore } from '../store/AppStore';
import { allStatusesOrdered, isAdminUser } from '../store/selectors';
import { StatusBadge } from '../components/StatusBadge';

// Lavender brand default for a freshly created status (dark-legible).
const NEW_STATUS_COLOR = '#c496ff';

export function AdminPage() {
  const { state, dispatch } = useStore();
  const admin = isAdminUser(state);

  const [statusInput, setStatusInput] = useState('');
  const [statusColor, setStatusColor] = useState(NEW_STATUS_COLOR);
  const [clientInput, setClientInput] = useState('');
  const [depInput, setDepInput] = useState('');
  const [svcInput, setSvcInput] = useState('');
  const [catInput, setCatInput] = useState('');

  if (!admin) {
    return (
      <section className="page">
        <div className="page-head">
          <h1>Administracja</h1>
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
        <h1>Administracja</h1>
      </div>

      <div className="editor-section">
        <h2>Statusy lejka</h2>
        <p className="field-hint">
          Statusy sterują kolumnami kanbana oraz statusem każdego projektu i zadania.
          Kolejność tutaj jest kolejnością w lejku. Zarchiwizowane statusy znikają
          z list wyboru, ale zachowują historię; usunięcie jest możliwe tylko, gdy status nie jest używany.
        </p>
        <ul className="admin-status-list">
          {statuses.map((s, i) => (
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
                  onClick={() =>
                    dispatch({ type: 'SET_STATUS_ARCHIVED', statusId: s.id, archived: !s.archived })
                  }
                >
                  {s.archived ? 'Przywróć' : 'Archiwizuj'}
                </button>
                <button
                  type="button"
                  className="btn danger-ghost"
                  disabled={statusInUse(s.id)}
                  title={statusInUse(s.id) ? 'Używany przez projekty lub zadania — zamiast tego zarchiwizuj' : undefined}
                  onClick={() => dispatch({ type: 'DELETE_STATUS', statusId: s.id })}
                >
                  Usuń
                </button>
              </span>
            </li>
          ))}
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

      <div className="editor-section">
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
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!clientInput.trim()) return;
            dispatch({ type: 'ADD_CLIENT', name: clientInput });
            setClientInput('');
          }}
        >
          <input
            value={clientInput}
            onChange={(e) => setClientInput(e.target.value)}
            placeholder="Nazwa nowego klienta"
            aria-label="Nazwa nowego klienta"
          />
          <button type="submit" className="btn primary" disabled={!clientInput.trim()}>
            Dodaj klienta
          </button>
        </form>
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
    </section>
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
        <li key={item.id} className="admin-simple-row">
          <input
            value={item.name}
            onChange={(e) => onRename(item.id, e.target.value)}
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
      ))}
    </ul>
  );
}
