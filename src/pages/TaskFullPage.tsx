// Pełny widok zadania pod `/tasks/:id` (IA-15). Trasa istniała dotąd jako
// przekierowanie do modala (`TaskRedirect`), przez co „otwórz zadanie w nowej
// karcie" zawsze lądowało w ciasnym oknie nad listą.
//
// Strona NIE duplikuje edytora: renderuje ten sam `TaskEditor`, co modal, i tę
// samą glue-logikę wokół niego (stan brudny → strażnik nawigacji, wskaźnik
// zapisu, odznaka powodów blokujących zapis, usuwanie przez wspólny
// `useDeleteTaskConfirm`). Auto-zapis przychodzi „za darmo" razem z edytorem.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore, usePersistence } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { OverflowMenu } from '../components/OverflowMenu';
import { SaveStatus } from '../components/SaveStatus';
import { TaskEditor, useDeleteTaskConfirm } from '../components/TaskModal';
import type { SaveBlocker } from '../components/taskSaveBlockers';
import { focusFieldById } from '../components/Field';
import { useSaveStatus } from '../utils/useSaveStatus';
import { bypassNavGuardOnce, clearNavGuard, setNavGuard } from '../utils/dirtyRegistry';
import { normalizeTaskRouteParam } from './taskPageRoute';

/** Lista zadań — cel powrotu po zapisie, anulowaniu i usunięciu. */
const TASKS_PATH = '/tasks';

export function TaskFullPage() {
  const { id } = useParams();
  const { state } = useStore();
  const taskId = normalizeTaskRouteParam(id);
  const task = taskId === null ? undefined : state.tasks.find((t) => t.id === taskId);

  if (!task) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Nie znaleziono zadania</p>
          <p className="empty-hint">Zadanie mogło zostać usunięte albo link jest nieaktualny.</p>
          <Link to={TASKS_PATH} className="btn primary">
            Wróć do listy zadań
          </Link>
        </div>
      </section>
    );
  }
  // Klucz na id zadania: przejście na inne zadanie zaczyna edycję od zera,
  // dokładnie jak `key={taskParam}` w modalu.
  return <TaskFullView key={task.id} taskId={task.id} title={task.title} />;
}

function TaskFullView({ taskId, title }: { taskId: string; title: string }) {
  const navigate = useNavigate();
  const canManageTasks = useCan()('tasks.manage');
  const { saveError } = usePersistence();

  // Stan brudny idzie Z edytora. Rejestracja w strażniku nawigacji jest
  // SYNCHRONICZNA (nie w efekcie): zapis czyści brudność i nawiguje w jednym
  // handlerze, a strażnik czyta rejestr dokładnie w trakcie tej nawigacji.
  const [dirty, setDirty] = useState(false);
  const navGuardKey = useRef<object>({});
  const handleDirtyChange = useCallback((next: boolean) => {
    setDirty(next);
    setNavGuard(navGuardKey.current, 'task-page', next);
  }, []);
  useEffect(() => {
    const key = navGuardKey.current;
    return () => clearNavGuard(key);
  }, []);

  const { status, savedAtLabel, markSaved } = useSaveStatus(dirty, saveError !== null);

  // IA-12 — powody blokujące zapis na odznace w nagłówku strony; skok do
  // przyczyny przychodzi Z edytora (najpierw przełącza zakładkę).
  const [blockers, setBlockers] = useState<SaveBlocker[]>([]);
  const jumpRef = useRef<(blocker: SaveBlocker) => void>((blocker) => {
    if (blocker.focusId !== null) focusFieldById(blocker.focusId);
  });
  const handleBlockersChange = useCallback(
    (next: SaveBlocker[], jump: (blocker: SaveBlocker) => void) => {
      jumpRef.current = jump;
      setBlockers(next);
    },
    [],
  );

  const deleteTask = useDeleteTaskConfirm(taskId);
  const backToList = useCallback(() => navigate(TASKS_PATH), [navigate]);
  /** Usunięcie już PYTAŁO (z listą skutków), więc strażnik nie pyta drugi raz. */
  const leaveAfterDelete = useCallback(() => {
    clearNavGuard(navGuardKey.current);
    bypassNavGuardOnce();
    backToList();
  }, [backToList]);

  return (
    <section className="page editor">
      <div className="page-head">
        <h1>{title}</h1>
        <div className="page-head-actions">
          <SaveStatus
            status={status}
            savedAtLabel={savedAtLabel}
            announceId="save:task-page"
            blocked={
              blockers.length > 0
                ? {
                    message: blockers[0].message,
                    onJump: () => jumpRef.current(blockers[0]),
                  }
                : undefined
            }
          />
          {canManageTasks && (
            <OverflowMenu
              label="Więcej działań"
              items={[
                {
                  id: 'delete',
                  label: 'Usuń zadanie',
                  danger: true,
                  onSelect: () => {
                    void deleteTask().then((deleted) => {
                      if (deleted) leaveAfterDelete();
                    });
                  },
                },
              ]}
            />
          )}
        </div>
      </div>
      {/* Pytanie o niezapisane zmiany należy do strażnika routera (zakres
          `task-page`), a nie do lokalnego potwierdzenia: strona żyje na
          ŚCIEŻCE, więc każde wyjście z niej i tak przechodzi przez strażnika. */}
      <TaskEditor
        taskId={taskId}
        onSaved={backToList}
        onCancel={backToList}
        onDirtyChange={handleDirtyChange}
        onBlockersChange={handleBlockersChange}
        markSaved={markSaved}
      />
    </section>
  );
}
