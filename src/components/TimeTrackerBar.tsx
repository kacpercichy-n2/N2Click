// Pasek wpisu czasu („Nad czym pracowałeś?"): JEDEN formularz dla wszystkich
// wejść trackera — wpis ręczny, rysowanie po osi wykonania (wypełnia godziny),
// klik w spotkanie (wypełnia tytuł i godziny) i poprawka istniejącego wpisu.
// Stan formularza należy do rodzica (`DayTrackerView`); tu jest wyłącznie UI:
// pole z podpowiedziami (wzorzec `mention-autocomplete` z CommentsPanel —
// lista inline, role="combobox"/"listbox", strzałki + Enter + Escape), godziny
// od-do, wiersz „Nowe zadanie" (projekt wymagany, kategoria opcjonalna),
// przyciski i linia statusu `aria-live`.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AppData, DateStr } from '../types';
import { getProject, getClient, getTask } from '../store/selectors';
import { projectDisplayName } from '../store/confidentiality';
import { resolveTaskByTitle, trackerSuggestions } from '../store/timeTracking';
import { formatMinutes, snapToStep, DAY_MINUTES } from '../utils/time';
import { formatMinutesDuration } from '../utils/timeTracking';
import { SaveStatus } from './SaveStatus';
import type { SaveState } from '../utils/useSaveStatus';

export interface TrackerFormState {
  text: string;
  /** Jawny wybór zadania z listy; `null` = tytuł rozstrzyga `resolveTaskByTitle`. */
  taskId: string | null;
  /** Użytkownik wybrał „+ nowe zadanie": pokazujemy wiersz z projektem. */
  creatingNew: boolean;
  newProjectId: string;
  newCategoryId: string;
  startMinutes: number;
  endMinutes: number;
  /** Poprawiany wpis (przycisk „Zapisz zmianę" + „Anuluj"). */
  editingId: string | null;
  /** Spotkanie, z którego wpis powstaje (klik „byłem"). */
  eventId: string | null;
}

export interface TrackerStatus {
  text: string;
  tone: 'ok' | 'error' | 'info';
}

interface Props {
  state: AppData;
  personId: string;
  date: DateStr;
  form: TrackerFormState;
  status: TrackerStatus | null;
  onChange: (patch: Partial<TrackerFormState>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Rodzic ustawia, gdy chce sfokusować pole (po rysowaniu / kliknięciu spotkania). */
  focusSignal: number;
  /** Prawda o UTRWALENIU (localStorage) — odznaka jak w TaskModal: „Zapisywanie…” →
   *  „Zapisano HH:mm”, a nieudany zapis „Nie zapisano”. Niezależna od linii statusu. */
  saveState: SaveState;
  savedAtLabel: string | null;
}

/** "9:05" / "09:05" / "905" -> minuty doby; null, gdy nie da się odczytać. */
function parseClock(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})(?::|\.)?(\d{2})?$/);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

function clockValue(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function TimeTrackerBar({
  state,
  personId,
  date,
  form,
  status,
  onChange,
  onSubmit,
  onCancel,
  focusSignal,
  saveState,
  savedAtLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Lokalne brudnopisy pól godzin: commit na blur/Enter (wpisywanie "9:" nie
  // może w locie psuć wartości formularza).
  const [startDraft, setStartDraft] = useState(clockValue(form.startMinutes));
  const [endDraft, setEndDraft] = useState(clockValue(form.endMinutes));
  useEffect(() => setStartDraft(clockValue(form.startMinutes)), [form.startMinutes]);
  useEffect(() => setEndDraft(clockValue(form.endMinutes)), [form.endMinutes]);

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  const suggestions = useMemo(
    () => trackerSuggestions(state, personId, date, form.text),
    [state, personId, date, form.text],
  );
  const resolution = useMemo(() => resolveTaskByTitle(state, form.text), [state, form.text]);
  const trimmed = form.text.trim();
  // „+ nowe zadanie" ma sens, gdy nic aktywnego nie pasuje dokładnie.
  const offerNew = trimmed !== '' && resolution.kind !== 'one' && resolution.kind !== 'ambiguous';
  const optionCount = suggestions.length + (offerNew ? 1 : 0);

  useEffect(() => {
    if (activeIndex >= optionCount) setActiveIndex(optionCount - 1);
  }, [optionCount, activeIndex]);

  const pickTask = (taskId: string, title: string) => {
    onChange({ taskId, text: title, creatingNew: false });
    setOpen(false);
    setActiveIndex(-1);
  };
  const pickNew = () => {
    onChange({
      taskId: null,
      creatingNew: true,
      newProjectId: form.newProjectId !== '' ? form.newProjectId : (state.projects[0]?.id ?? ''),
    });
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => (optionCount === 0 ? -1 : (i + 1) % optionCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => (optionCount === 0 ? -1 : (i - 1 + optionCount) % optionCount));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0) {
        if (activeIndex < suggestions.length) {
          const s = suggestions[activeIndex];
          pickTask(s.task.id, s.title);
        } else {
          pickNew();
        }
        return;
      }
      setOpen(false);
      onSubmit();
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      } else if (form.editingId !== null) {
        e.stopPropagation();
        onCancel();
      }
    }
  };

  const commitClock = (which: 'start' | 'end', raw: string) => {
    const parsed = parseClock(raw);
    if (parsed === null) {
      // wróć do ostatniej poprawnej wartości
      if (which === 'start') setStartDraft(clockValue(form.startMinutes));
      else setEndDraft(clockValue(form.endMinutes));
      return;
    }
    const snapped = Math.max(0, Math.min(DAY_MINUTES, snapToStep(parsed)));
    if (which === 'start') {
      const end = form.endMinutes <= snapped ? Math.min(DAY_MINUTES, snapped + 15) : form.endMinutes;
      onChange({ startMinutes: snapped, endMinutes: end });
    } else {
      onChange({ endMinutes: snapped });
    }
  };

  // Etykieta projektu: z wybranego zadania, z jednoznacznego tytułu albo z wiersza „Nowe zadanie".
  const resolvedTask =
    form.taskId !== null ? getTask(state, form.taskId) : resolution.kind === 'one' ? resolution.task : undefined;
  const projectLabel = (() => {
    const projectId =
      resolvedTask?.projectId ?? (form.creatingNew && form.newProjectId !== '' ? form.newProjectId : '');
    if (projectId === '') return null;
    const project = getProject(state, projectId);
    if (project === undefined) return null;
    const client = getClient(state, project.clientId);
    return `${client?.name ?? ''}${client ? ' · ' : ''}${projectDisplayName(state, project)}`;
  })();

  const duration = Math.max(0, form.endMinutes - form.startMinutes);
  const editing = form.editingId !== null;
  const showNewRow = form.creatingNew && trimmed !== '' && resolution.kind !== 'one' && resolution.kind !== 'ambiguous';

  return (
    <section
      className={`tt-bar${editing ? ' editing' : ''}`}
      aria-label={editing ? 'Poprawka wpisu czasu' : 'Nowy wpis czasu'}
    >
      <div className="tt-bar-row">
        <div className="tt-what">
          <label className="sr-only" htmlFor={`${listId}-what`}>
            Nad czym pracowałeś
          </label>
          <input
            id={`${listId}-what`}
            ref={inputRef}
            type="text"
            className="tt-what-input"
            value={form.text}
            placeholder="Nad czym pracowałeś? Zacznij pisać, hub podpowie z zadań"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              setActiveIndex(-1);
            }}
            onChange={(e) => {
              onChange({ text: e.target.value, taskId: null, creatingNew: false });
              setOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={onKeyDown}
          />
          {open && (optionCount > 0 || trimmed !== '') ? (
            <ul className="tt-suggest" id={listId} role="listbox" aria-label="Podpowiedzi zadań">
              {suggestions.map((s, i) => (
                <li key={s.task.id} id={`${listId}-${i}`} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    className={i === activeIndex ? 'tt-option active' : 'tt-option'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickTask(s.task.id, s.title)}
                  >
                    <span className="tt-option-main">
                      <strong>{s.title}</strong>
                      {s.plannedToday ? <span className="tt-tag">dziś w planie</span> : null}
                    </span>
                    <span className="tt-option-meta">
                      {s.clientName}
                      {s.clientName && s.projectName ? ' · ' : ''}
                      {s.projectName}
                    </span>
                    <span className="tt-option-logged">
                      {formatMinutesDuration(s.loggedMinutes)}
                      {s.estimateMinutes === null ? '' : ` z ${formatMinutesDuration(s.estimateMinutes)}`}
                    </span>
                  </button>
                </li>
              ))}
              {offerNew ? (
                <li
                  id={`${listId}-${suggestions.length}`}
                  role="option"
                  aria-selected={activeIndex === suggestions.length}
                >
                  <button
                    type="button"
                    className={activeIndex === suggestions.length ? 'tt-option new active' : 'tt-option new'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={pickNew}
                  >
                    <span className="tt-option-main">
                      <strong>+ „{trimmed}” jako nowe zadanie</strong>
                    </span>
                    <span className="tt-option-meta">
                      {resolution.kind === 'closed'
                        ? 'Zadanie o tej nazwie jest zamknięte. Nowe powstanie w wybranym projekcie.'
                        : 'Hub zapyta o projekt. Zostanie w bazie i będzie się podpowiadać.'}
                    </span>
                  </button>
                </li>
              ) : null}
              {optionCount === 0 ? <li className="tt-suggest-empty">Brak pasujących zadań</li> : null}
            </ul>
          ) : null}
        </div>

        <span className={`tt-project${projectLabel ? ' set' : ''}`} title="Projekt bierze się z zadania">
          {projectLabel ?? 'Projekt: z zadania'}
        </span>

        <div className="tt-times">
          <label className="sr-only" htmlFor={`${listId}-from`}>
            Od godziny
          </label>
          <input
            id={`${listId}-from`}
            className="tt-time"
            type="text"
            inputMode="numeric"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={(e) => commitClock('start', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitClock('start', (e.target as HTMLInputElement).value);
              }
            }}
          />
          <span className="tt-dash" aria-hidden>
            -
          </span>
          <label className="sr-only" htmlFor={`${listId}-to`}>
            Do godziny
          </label>
          <input
            id={`${listId}-to`}
            className="tt-time"
            type="text"
            inputMode="numeric"
            value={endDraft}
            onChange={(e) => setEndDraft(e.target.value)}
            onBlur={(e) => commitClock('end', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitClock('end', (e.target as HTMLInputElement).value);
              }
            }}
          />
          <span className="tt-duration" aria-label="Długość wpisu">
            {formatMinutesDuration(duration)}
          </span>
        </div>

        <button type="button" className="btn primary" onClick={onSubmit}>
          {editing ? 'Zapisz zmianę' : 'Zapisz'}
        </button>
        {editing ? (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Anuluj
          </button>
        ) : null}
      </div>

      {showNewRow ? (
        <div className="tt-bar-sub">
          <span className="tt-new-tag">Nowe zadanie</span>
          <label className="tt-sub-field">
            <span>w projekcie</span>
            <select
              value={form.newProjectId}
              onChange={(e) => onChange({ newProjectId: e.target.value })}
              aria-label="Projekt nowego zadania"
            >
              <option value="">wybierz projekt</option>
              {state.projects
                .filter((p) => !getClient(state, p.clientId)?.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {getClient(state, p.clientId)?.name ?? 'Klient'} · {projectDisplayName(state, p)}
                  </option>
                ))}
            </select>
          </label>
          <label className="tt-sub-field">
            <span>kategoria</span>
            <select
              value={form.newCategoryId}
              onChange={(e) => onChange({ newCategoryId: e.target.value })}
              aria-label="Kategoria pracy (opcjonalnie)"
            >
              <option value="">bez kategorii</option>
              {state.workCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <span className="tt-sub-hint">Zostanie w bazie i będzie się podpowiadać następnym razem.</span>
        </div>
      ) : null}

      {editing ? (
        <div className="tt-bar-sub tt-edit-note">
          Poprawiasz wpis {formatMinutes(form.startMinutes)}-{formatMinutes(form.endMinutes)}. Zmień godziny albo
          zadanie i zapisz. Esc anuluje.
        </div>
      ) : null}

      <div className="tt-status-row">
        <div className={`tt-status${status ? ` ${status.tone}` : ''}`} role="status" aria-live="polite">
          {status?.text ?? ''}
        </div>
        <SaveStatus status={saveState} savedAtLabel={savedAtLabel} announceId="save:time-tracker" />
      </div>
    </section>
  );
}
