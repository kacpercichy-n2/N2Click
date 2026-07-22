// Project detail card: editable fields (client, status, paid coin, dates,
// department, service type, description), milestones, dokumenty handlowe
// (odnośniki), the project's tasks, and the chat/comments + activity section.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore, usePersistence } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { NO_PERM_TITLE } from '../store/permissions';
import type { ProjectDraft } from '../store/AppStore';
import type { ProjectDocument, ProjectDocumentKind } from '../types';
import {
  DEFAULT_PROJECT_DOCUMENT_KIND,
  PROJECT_DOCUMENT_KINDS,
  PROJECT_DOCUMENT_KIND_LABELS,
  normalizeProjectDocumentUrl,
} from '../utils/projectDocuments';
import {
  activeStatuses,
  assigneesOfTask,
  departmentsOfProject,
  getStatus,
  milestonesOfProject,
  projectPlannedTotal,
  taskPlannedTotal,
  taskPlanningStatus,
  orderedTasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { PlanningBadge } from '../components/PlanningBadge';
import { PersonChip } from '../components/PersonChip';
import { CommentsPanel } from '../components/CommentsPanel';
import { SaveStatus } from '../components/SaveStatus';
import { useOpenTask } from '../components/TaskModal';
import { ChevronRight } from '../components/icons';
import { formatShortWithWeekday, todayStr, isValidDateStr, periodError, PERIOD_ERROR_LABELS } from '../utils/dates';
import { formatDuration } from '../utils/time';
import { useSaveStatus } from '../utils/useSaveStatus';
import { useAutoSave } from '../utils/useAutoSave';
import {
  isValidProjectDocumentDraft,
  isValidProjectDraft,
} from '../store/commandValidation';
import {
  bypassNavGuardOnce,
  clearNavGuard,
  setNavGuard,
} from '../utils/dirtyRegistry';

export function ProjectDetailPage() {
  const { id } = useParams();
  const { state } = useStore();
  const project = state.projects.find((p) => p.id === id);

  if (!project) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Nie znaleziono projektu</p>
          <Link to="/projects" className="btn primary">
            Wróć do projektów
          </Link>
        </div>
      </section>
    );
  }
  // Key by project id so the editable draft resets when switching projects.
  return <ProjectDetail key={project.id} projectId={project.id} />;
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { openTask, openNewTask } = useOpenTask();
  const { state, dispatch } = useStore();
  const can = useCan();
  const canManage = can('projects.manage');
  const canPaid = can('projects.paid');
  const canManageTasks = can('tasks.manage');
  const disabledTitle = canManage ? undefined : NO_PERM_TITLE;
  const project = state.projects.find((p) => p.id === projectId);

  // ---- Editable draft (component remounts per project id) ----
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [clientId, setClientId] = useState(project?.clientId ?? '');
  const [statusId, setStatusId] = useState(project?.statusId ?? '');
  const [startDate, setStartDate] = useState(project?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(project?.endDate ?? todayStr());
  // Zaszłość: wartość tylko przenoszona przez zapis (działy projektu są teraz
  // pochodne z zadań — patrz selectors.departmentsOfProject), bez edycji w UI.
  const [departmentId] = useState(project?.departmentId ?? '');
  const [serviceTypeId, setServiceTypeId] = useState(project?.serviceTypeId ?? '');
  // Spółka wykonawcza projektu (2026-07-22): jawne przypisanie ze słownika,
  // steruje domyślnym filtrem widoków — patrz types.Project.companyId.
  const [companyId, setCompanyId] = useState(project?.companyId ?? '');
  const [error, setError] = useState('');

  // ---- Milestone form ----
  const [msName, setMsName] = useState('');
  const [msDate, setMsDate] = useState(todayStr());
  const [msError, setMsError] = useState('');

  // ---- Formularz dokumentów (jeden formularz obsługuje dodawanie i edycję) ----
  // `docEditId === null` => dodawanie nowego odnośnika.
  const [docEditId, setDocEditId] = useState<string | null>(null);
  const [docKind, setDocKind] = useState<ProjectDocumentKind>(DEFAULT_PROJECT_DOCUMENT_KIND);
  const [docLabel, setDocLabel] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docError, setDocError] = useState('');

  const dirty = project
    ? name !== project.name ||
      description !== project.description ||
      clientId !== project.clientId ||
      statusId !== project.statusId ||
      startDate !== project.startDate ||
      endDate !== project.endDate ||
      departmentId !== project.departmentId ||
      serviceTypeId !== project.serviceTypeId ||
      companyId !== (project.companyId ?? '')
    : false;
  const { saveError, external } = usePersistence();
  const { status, markSaved } = useSaveStatus(dirty, saveError !== null);

  // Register the dirty draft with the router navigation guard so leaving the
  // page (sidebar links, Back/Forward, any route change) asks first. Explicit
  // in-page navigations that already confirmed arm a one-shot bypass below.
  const navGuardKey = useRef<object>({});
  useEffect(() => {
    const key = navGuardKey.current;
    setNavGuard(key, 'project-detail', dirty);
    return () => clearNavGuard(key);
  }, [dirty]);

  // Zapis (przycisk + auto-zapis). Zdefiniowany PRZED wczesnym returnem, żeby
  // hook auto-zapisu miał stałą kolejność hooków.
  const save = () => {
    if (!project) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nazwa projektu jest wymagana');
      return;
    }
    const perErr = periodError(startDate, endDate);
    if (perErr) {
      setError(PERIOD_ERROR_LABELS[perErr]);
      return;
    }
    const trimmedDescription = description.trim();
    const draft: ProjectDraft = {
      clientId,
      name: trimmed,
      description: trimmedDescription,
      statusId,
      paid: project.paid,
      startDate,
      endDate,
      departmentId,
      serviceTypeId,
      companyId,
    };
    dispatch({ type: 'SAVE_PROJECT', projectId: project.id, draft });
    // Normalize local state to exactly what was persisted so `dirty` clears
    // (otherwise untrimmed whitespace keeps the form permanently dirty).
    setName(trimmed);
    setDescription(trimmedDescription);
    setError('');
    markSaved();
  };

  // Ten sam zestaw bramek co reduktor SAVE_PROJECT — niepoprawny draft czeka
  // na poprawkę (walidacja inline), nigdy nie zapisuje się w tle.
  const autoSaveValid = project
    ? periodError(startDate, endDate) === null &&
      isValidProjectDraft(
        state,
        {
          clientId,
          name,
          description,
          statusId,
          paid: project.paid,
          startDate,
          endDate,
          departmentId,
          serviceTypeId,
          companyId,
        },
        project,
      )
    : false;
  useAutoSave({
    // Jawny konflikt kart wstrzymuje auto-zapis: cichy zapis w tle byłby
    // niejawnym „zostaw moją wersję” — o tym decyduje użytkownik w banerze.
    enabled: canManage && Boolean(project) && external !== 'conflict',
    dirty,
    valid: autoSaveValid,
    signature: JSON.stringify([
      name,
      description,
      clientId,
      statusId,
      startDate,
      endDate,
      departmentId,
      serviceTypeId,
      companyId,
    ]),
    save,
  });

  // Deleted mid-render (e.g. right after the delete dispatch, before the route
  // change lands): render nothing for that frame.
  if (!project) return null;

  const tasks = orderedTasksOfProject(state, project.id);
  // Szkice zadań tego projektu — widoczne tylko tutaj, publikowane atomowo jedną
  // akcją (inwariant 6). „Zapisz i opublikuj” przełącza wszystkie naraz.
  const draftCount = tasks.filter((t) => t.isDraft === true).length;
  const publishDrafts = () => {
    if (draftCount === 0) return;
    const label =
      draftCount === 1
        ? 'Opublikować 1 szkic zadania?'
        : `Opublikować ${draftCount} szkiców zadań?`;
    if (!window.confirm(`${label} Staną się widoczne w planowaniu (kalendarz, zasobnik, Moja praca).`)) {
      return;
    }
    dispatch({ type: 'PUBLISH_PROJECT_DRAFTS', projectId: project.id });
  };
  const derivedDepartments = departmentsOfProject(state, project.id);
  const milestones = milestonesOfProject(state, project.id);
  const statuses = activeStatuses(state);
  const currentStatus = getStatus(state, project.statusId);
  // Archived current status must remain pickable so the select isn't lying.
  const pickableStatuses =
    currentStatus && currentStatus.archived ? [...statuses, currentStatus] : statuses;

  const togglePaid = () =>
    dispatch({ type: 'SET_PROJECT_PAID', projectId: project.id, paid: !project.paid });

  const remove = () => {
    if (
      window.confirm(
        `Usunąć projekt „${project.name}”? To usunie ${tasks.length} zadań, przypisania, zaplanowane godziny, kamienie milowe i komentarze.`,
      )
    ) {
      dispatch({ type: 'DELETE_PROJECT', projectId: project.id });
      // The guard registry still holds the (now moot) dirty draft until the
      // next effect pass — this navigation was deliberately confirmed.
      bypassNavGuardOnce();
      navigate('/projects');
    }
  };

  const addMilestone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msName.trim()) return;
    if (!isValidDateStr(msDate)) {
      setMsError('Podaj prawidłową datę kamienia milowego.');
      return;
    }
    dispatch({
      type: 'SAVE_MILESTONE',
      milestoneId: null,
      projectId: project.id,
      name: msName,
      date: msDate,
    });
    setMsName('');
    setMsError('');
  };

  const resetDocForm = () => {
    setDocEditId(null);
    setDocKind(DEFAULT_PROJECT_DOCUMENT_KIND);
    setDocLabel('');
    setDocUrl('');
    setDocError('');
  };

  const startDocEdit = (doc: ProjectDocument) => {
    setDocEditId(doc.id);
    setDocKind(doc.kind);
    setDocLabel(doc.label);
    setDocUrl(doc.url);
    setDocError('');
  };

  // Ta sama bramka co reduktor (isValidProjectDocumentDraft): pusty adres nie
  // dociera do dispatchu, tylko zapala komunikat inline.
  const submitDocument = (e: React.FormEvent) => {
    e.preventDefault();
    const draft = { kind: docKind, label: docLabel, url: docUrl };
    if (!isValidProjectDocumentDraft(draft)) {
      setDocError('Podaj poprawny adres dokumentu (http:// lub https://).');
      return;
    }
    if (docEditId === null) {
      dispatch({ type: 'ADD_PROJECT_DOCUMENT', projectId: project.id, draft });
    } else {
      dispatch({
        type: 'SAVE_PROJECT_DOCUMENT',
        projectId: project.id,
        documentId: docEditId,
        draft,
      });
    }
    resetDocForm();
  };

  const removeDocument = (doc: ProjectDocument) => {
    if (!window.confirm(`Usunąć dokument „${doc.label || doc.url}”?`)) return;
    if (docEditId === doc.id) resetDocForm();
    dispatch({
      type: 'DELETE_PROJECT_DOCUMENT',
      projectId: project.id,
      documentId: doc.id,
    });
  };

  return (
    <section className="page editor">
      <div className="page-head">
        <h1 className="project-detail-title">
          <Coin paid={project.paid} size={24} onToggle={canPaid ? togglePaid : undefined} />
          {project.name}
          <StatusBadge status={currentStatus} />
        </h1>
        <div className="page-head-actions">
          <SaveStatus status={status} />
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (
                dirty &&
                !window.confirm('Masz niezapisane zmiany. Opuścić bez zapisywania?')
              ) {
                return;
              }
              // Already confirmed (or clean) — don't let the router guard ask again.
              bypassNavGuardOnce();
              navigate('/projects');
            }}
          >
            Wróć
          </button>
          {canManage && (
            <button type="button" className="btn danger-ghost" onClick={remove}>
              Usuń projekt
            </button>
          )}
        </div>
      </div>

      <div className="editor-section">
        <h2>Szczegóły</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pd-name">Nazwa *</label>
            <input
              id="pd-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            />
          </div>
          <div className="field">
            <label htmlFor="pd-client">Klient *</label>
            <select
              id="pd-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              {state.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pd-status">Status *</label>
            <select
              id="pd-status"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              {pickableStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.archived ? ' (zarchiwizowany)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pd-start">Data startu</label>
            <input
              id="pd-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            />
          </div>
          <div className="field">
            <label htmlFor="pd-end">Data końca</label>
            <input
              id="pd-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            />
          </div>
          <div className="field">
            {/* Działy projektu są POCHODNE z działów jego zadań (dział wybiera
                się w edytorze zadania) — projekt może obejmować kilka działów. */}
            <label>Działy (z zadań)</label>
            <div className="project-derived-departments">
              {derivedDepartments.length === 0 ? (
                <span className="muted">— przypisz dział w zadaniu</span>
              ) : (
                derivedDepartments.map((d) => (
                  <span key={d.id} className="project-badge project-badge-department">
                    {d.name}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="field">
            <label htmlFor="pd-svc">Typ usługi</label>
            <select
              id="pd-svc"
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              <option value="">—</option>
              {state.serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pd-company">Spółka wykonawcza</label>
            <select
              id="pd-company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={!canManage}
              title={disabledTitle}
            >
              <option value="">—</option>
              {state.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pd-desc">Opis</label>
          <textarea
            id="pd-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canManage}
            title={disabledTitle}
          />
        </div>
        <div className="field-row payment-row">
          <span className="field-hint">
            Płatność: <Coin paid={project.paid} onToggle={canPaid ? togglePaid : undefined} />{' '}
            <strong>{project.paid ? 'opłacony' : 'nieopłacony'}</strong>
            {canPaid && ' (kliknij monetę, aby przełączyć)'}
          </span>
        </div>
        {error && <p className="field-error">{error}</p>}
        {(dirty || status !== 'clean') && (
          <div className="editor-actions editor-actions-sticky">
            <span className="field-hint autosave-hint" role="status">
              Zmiany zapisują się automatycznie.
            </span>
            <button type="button" className="btn primary" onClick={save} disabled={!dirty}>
              Zapisz teraz
            </button>
          </div>
        )}
      </div>

      <div className="editor-section">
        <h2>Kamienie milowe</h2>
        {milestones.length === 0 ? (
          <p className="field-hint">Brak kamieni milowych.</p>
        ) : (
          <ul className="milestone-list">
            {milestones.map((m) => (
              <li key={m.id} className="milestone-row">
                <span className="milestone-diamond" aria-hidden>
                  ◆
                </span>
                <span className="milestone-name">{m.name}</span>
                <input
                  type="date"
                  value={m.date}
                  onChange={(e) => {
                    // Ignore invalid/cleared dates — the controlled input snaps
                    // back to the stored value, so the milestone keeps its date.
                    if (!isValidDateStr(e.target.value)) return;
                    dispatch({
                      type: 'MOVE_MILESTONE',
                      milestoneId: m.id,
                      date: e.target.value,
                    });
                  }}
                  aria-label={`Data dla ${m.name}`}
                  disabled={!canManage}
                  title={disabledTitle}
                />
                {canManage && (
                  <button
                    type="button"
                    className="btn danger-ghost"
                    onClick={() => dispatch({ type: 'DELETE_MILESTONE', milestoneId: m.id })}
                  >
                    Usuń
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form className="milestone-form" onSubmit={addMilestone}>
            <input
              value={msName}
              onChange={(e) => setMsName(e.target.value)}
              placeholder="Nazwa kamienia milowego"
              aria-label="Nazwa kamienia milowego"
            />
            <input
              type="date"
              value={msDate}
              onChange={(e) => setMsDate(e.target.value)}
              aria-label="Data kamienia milowego"
            />
            <button type="submit" className="btn soft" disabled={!msName.trim()}>
              Dodaj kamień milowy
            </button>
            {msError && <p className="field-error">{msError}</p>}
          </form>
        )}
      </div>

      <div className="editor-section">
        <h2>Dokumenty</h2>
        {/* Wyłącznie ODNOŚNIKI (oferta, wycena, brief, link) — aplikacja nie
            przechowuje plików. Odnośnik otwiera się w nowej karcie. */}
        {project.documents.length === 0 ? (
          <p className="field-hint">Brak dokumentów.</p>
        ) : (
          <ul className="document-list">
            {project.documents.map((d) => {
              // Obrona przy RENDEROWANIU, nie tylko na wejściu: projekty są
              // danymi współdzielonymi, więc wiersz mógł przyjść z chmury albo
              // ze starszego zapisu. Adres o niedozwolonym schemacie nie trafia
              // do `href` — pokazujemy sam tekst.
              const href = normalizeProjectDocumentUrl(d.url);
              return (
                <li key={d.id} className="document-row">
                  <span className="project-badge project-badge-document">
                    {PROJECT_DOCUMENT_KIND_LABELS[d.kind]}
                  </span>
                  {href === null ? (
                    <span className="document-link document-link-blocked" title={d.url}>
                      {d.label || d.url} (niedozwolony adres)
                    </span>
                  ) : (
                    <a
                      className="document-link"
                      href={href}
                      target="_blank"
                      rel="noopener"
                      title={href}
                    >
                      {d.label || d.url}
                    </a>
                  )}
                  {canManage && (
                    <span className="document-row-actions">
                      <button type="button" className="btn ghost" onClick={() => startDocEdit(d)}>
                        Edytuj
                      </button>
                      <button
                        type="button"
                        className="btn danger-ghost"
                        onClick={() => removeDocument(d)}
                      >
                        Usuń
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canManage && (
          <form className="document-form" onSubmit={submitDocument}>
            <select
              value={docKind}
              onChange={(e) => setDocKind(e.target.value as ProjectDocumentKind)}
              aria-label="Rodzaj dokumentu"
            >
              {PROJECT_DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROJECT_DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              value={docLabel}
              onChange={(e) => setDocLabel(e.target.value)}
              placeholder="Nazwa (opcjonalnie)"
              aria-label="Nazwa dokumentu"
            />
            <input
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="Adres (URL) *"
              aria-label="Adres dokumentu"
            />
            <button type="submit" className="btn soft" disabled={!docUrl.trim()}>
              {docEditId === null ? 'Dodaj dokument' : 'Zapisz dokument'}
            </button>
            {docEditId !== null && (
              <button type="button" className="btn ghost" onClick={resetDocForm}>
                Anuluj
              </button>
            )}
            {docError && <p className="field-error">{docError}</p>}
          </form>
        )}
      </div>

      <div className="editor-section">
        <div className="section-head">
          <h2>Zadania ({tasks.length})</h2>
          {canManageTasks && (
            <div className="section-head-actions">
              {draftCount > 0 && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={publishDrafts}
                  title="Opublikuj wszystkie szkice zadań w tym projekcie"
                >
                  Zapisz i opublikuj ({draftCount})
                </button>
              )}
              <button
                type="button"
                className="btn soft"
                onClick={() => openNewTask(project.id)}
              >
                + Nowe zadanie
              </button>
            </div>
          )}
        </div>
        {draftCount > 0 && (
          <p className="field-hint">
            {draftCount === 1
              ? 'Ten projekt ma 1 szkic zadania.'
              : `Ten projekt ma ${draftCount} szkiców zadań.`}{' '}
            Szkice są widoczne tylko tutaj i nie trafiają do planowania (kalendarz,
            zasobnik, Moja praca), dopóki nie klikniesz „Zapisz i opublikuj”.
          </p>
        )}
        <p className="field-hint">
          Zaplanowano {formatDuration(projectPlannedTotal(state, project.id))} w całym projekcie.
        </p>
        {tasks.length === 0 ? (
          <p className="field-hint">W tym projekcie nie ma jeszcze zadań.</p>
        ) : (
          <ul className="project-task-list">
            {tasks.map((t, i) => (
              <li key={t.id} className="project-task-row">
                <button
                  type="button"
                  className="project-task-main"
                  onClick={() => openTask(t.id)}
                >
                  <span className="task-title">{t.title}</span>
                  {t.isDraft === true && (
                    <span className="project-badge project-badge-draft" title="Szkic — nieopublikowane">
                      szkic
                    </span>
                  )}
                  <StatusBadge status={getStatus(state, t.statusId)} />
                  {t.isDraft !== true && (
                    <PlanningBadge status={taskPlanningStatus(state, t.id)} />
                  )}
                  <span className="muted">
                    {formatShortWithWeekday(t.startDate)} – {formatShortWithWeekday(t.endDate)} ·{' '}
                    {formatDuration(taskPlannedTotal(state, t.id))}
                  </span>
                  <span className="task-card-assignees">
                    {assigneesOfTask(state, t.id).map((p) => (
                      <PersonChip key={p.id} person={p} />
                    ))}
                  </span>
                  <ChevronRight className="card-chevron" size={16} aria-hidden />
                </button>
                {canManageTasks && (
                  <span className="project-task-reorder">
                    <button
                      type="button"
                      className="nav-btn"
                      disabled={i === 0}
                      onClick={() =>
                        dispatch({ type: 'REORDER_PROJECT_TASK', taskId: t.id, direction: -1 })
                      }
                      aria-label={`Przesuń zadanie „${t.title}” wyżej`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="nav-btn"
                      disabled={i === tasks.length - 1}
                      onClick={() =>
                        dispatch({ type: 'REORDER_PROJECT_TASK', taskId: t.id, direction: 1 })
                      }
                      aria-label={`Przesuń zadanie „${t.title}” niżej`}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="editor-section">
        <h2>Dyskusja</h2>
        <CommentsPanel entityType="project" entityId={project.id} />
      </div>
    </section>
  );
}
