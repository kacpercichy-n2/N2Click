// Admin panel: pipeline statuses (create incl. "/name" quick command, rename,
// recolor, reorder, archive/restore, delete-when-unused), clients, departments,
// and service types. Only admins ("acting as" someone with the admin flag) may
// change anything here.
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

  if (!admin) {
    return (
      <section className="page">
        <div className="page-head">
          <h1>Admin</h1>
        </div>
        <div className="empty-state">
          <p className="empty-title">Admins only</p>
          <p className="empty-hint">
            Switch "Acting as" in the header to a person with admin rights to manage
            statuses, clients, departments, and service types.
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
        <h1>Admin</h1>
      </div>

      <div className="editor-section">
        <h2>Pipeline statuses</h2>
        <p className="field-hint">
          Statuses drive the kanban columns and the status of every project and task.
          Order here = order in the pipeline. Archived statuses disappear from pickers
          but keep historical items intact; delete is only possible when unused.
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
                aria-label={`Color of ${s.name}`}
              />
              <input
                className="admin-status-name"
                value={s.name}
                onChange={(e) =>
                  dispatch({ type: 'SAVE_STATUS', statusId: s.id, name: e.target.value, color: s.color })
                }
                aria-label={`Name of status ${s.name}`}
              />
              <code className="muted admin-status-slug">/{s.slug}</code>
              <StatusBadge status={s} />
              <span className="admin-status-actions">
                <button
                  type="button"
                  className="nav-btn"
                  disabled={i === 0}
                  onClick={() => dispatch({ type: 'REORDER_STATUS', statusId: s.id, direction: -1 })}
                  aria-label={`Move ${s.name} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  disabled={i === statuses.length - 1}
                  onClick={() => dispatch({ type: 'REORDER_STATUS', statusId: s.id, direction: 1 })}
                  aria-label={`Move ${s.name} later`}
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
                  {s.archived ? 'Restore' : 'Archive'}
                </button>
                <button
                  type="button"
                  className="btn danger-ghost"
                  disabled={statusInUse(s.id)}
                  title={statusInUse(s.id) ? 'In use by projects or tasks — archive instead' : undefined}
                  onClick={() => dispatch({ type: 'DELETE_STATUS', statusId: s.id })}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form className="admin-add-form" onSubmit={addStatus}>
          <input
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value)}
            placeholder='New status — try the quick command "/Client review"'
            aria-label="New status name"
          />
          <input
            type="color"
            value={statusColor}
            onChange={(e) => setStatusColor(e.target.value)}
            aria-label="New status color"
          />
          <button type="submit" className="btn primary" disabled={!statusInput.replace(/^\//, '').trim()}>
            Add status
          </button>
        </form>
      </div>

      <div className="editor-section">
        <h2>Clients</h2>
        <SimpleList
          items={state.clients.map((c) => ({ id: c.id, name: c.name }))}
          onRename={(id, name) => dispatch({ type: 'RENAME_CLIENT', clientId: id, name })}
          onDelete={(id, name) => {
            const count = state.projects.filter((p) => p.clientId === id).length;
            if (
              window.confirm(
                `Delete client "${name}"?${count > 0 ? ` This also deletes their ${count} project(s) with all tasks and planned hours.` : ''}`,
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
            placeholder="New client name"
            aria-label="New client name"
          />
          <button type="submit" className="btn primary" disabled={!clientInput.trim()}>
            Add client
          </button>
        </form>
      </div>

      <div className="editor-section">
        <h2>Departments</h2>
        <SimpleList
          items={state.departments}
          onRename={(id, name) => dispatch({ type: 'RENAME_DEPARTMENT', departmentId: id, name })}
          onDelete={(id, name) => {
            if (window.confirm(`Delete department "${name}"? People and projects lose the tag.`)) {
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
            placeholder="New department name"
            aria-label="New department name"
          />
          <button type="submit" className="btn primary" disabled={!depInput.trim()}>
            Add department
          </button>
        </form>
      </div>

      <div className="editor-section">
        <h2>Service types</h2>
        <SimpleList
          items={state.serviceTypes}
          onRename={(id, name) =>
            dispatch({ type: 'RENAME_SERVICE_TYPE', serviceTypeId: id, name })
          }
          onDelete={(id, name) => {
            if (window.confirm(`Delete service type "${name}"? Projects lose the tag.`)) {
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
            placeholder="New service type name"
            aria-label="New service type name"
          />
          <button type="submit" className="btn primary" disabled={!svcInput.trim()}>
            Add service type
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
  if (items.length === 0) return <p className="field-hint">None yet.</p>;
  return (
    <ul className="admin-simple-list">
      {items.map((item) => (
        <li key={item.id} className="admin-simple-row">
          <input
            value={item.name}
            onChange={(e) => onRename(item.id, e.target.value)}
            aria-label={`Rename ${item.name}`}
          />
          <button
            type="button"
            className="btn danger-ghost"
            onClick={() => onDelete(item.id, item.name)}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
