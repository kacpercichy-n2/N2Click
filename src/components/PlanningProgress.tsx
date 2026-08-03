import type { PlanningStatus } from '../store/selectors';
import { planningProgress } from '../utils/planningProgress';
import { formatDuration } from '../utils/time';

interface Props {
  /** Σ zaplanowanych godzin zadania (`taskPlannedTotal`). */
  planned: number;
  /** `Task.estimatedHours` — `null` znaczy „brak celu”. */
  estimate: number | null;
  /**
   * Stan z selektora (`taskPlanningStatus`). Etykieta zna tylko parę
   * (zaplanowane, szacunek), więc niuans zasobnika („częściowo”, mimo że suma
   * dobija do szacunku) niesie ten tekst dla czytnika ekranu — nic z pigułki
   * `.planning-badge` nie ginie.
   */
  status?: PlanningStatus;
  /** Czy renderować tekst godzin („zaplanowano X / szac. Y”). Wyłączony tam,
   * gdzie wiersz już pokazuje godziny (karta projektu, Panel). */
  showHours?: boolean;
}

/**
 * Rozplanowanie godzin w wierszu listy: LICZBY plus tekst dla czytnika ekranu.
 * Zastąpiło pigułkę `.planning-badge` (ta zostaje w TaskModalu, gdzie żyją
 * szczegóły). Cienki pasek postępu ZNIKNĄŁ (decyzja operatora 2026-08-03): tor
 * miał stałą szerokość 56 px, więc na kartach wyglądał zawsze tak samo i nie
 * niósł żadnej informacji ponad tę, która i tak stoi obok słowami. Arytmetyka
 * została w `utils/planningProgress.ts` — nadal daje etykietę dla czytnika
 * ekranu (procent bywa niesłyszalny w samym „zaplanowano X / szac. Y”).
 */
export function PlanningProgress({ planned, estimate, status, showHours = true }: Props) {
  const view = planningProgress(planned, estimate);
  const body = (
    <>
      <span className="sr-only">{view.label}</span>
      {status !== undefined && <span className="sr-only">Stan planowania: {status}</span>}
    </>
  );
  // Bez tekstu godzin nie ma czego opakowywać: sam `.sr-only` idzie prosto do
  // wiersza wywołującego, więc pusty wizualnie wariant nie zostawia po sobie
  // odstępu w jego siatce/flexie.
  if (!showHours) return body;
  return (
    <span className="planning-progress">
      <span className="planning-progress-hours">
        <strong>zaplanowano {formatDuration(planned)}</strong>
        {estimate != null && <span className="muted"> / szac. {formatDuration(estimate)}</span>}
      </span>
      {body}
    </span>
  );
}
