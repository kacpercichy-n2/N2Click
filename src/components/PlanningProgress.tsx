import type { PlanningStatus } from '../store/selectors';
import { planningProgress } from '../utils/planningProgress';
import { formatDuration } from '../utils/time';

interface Props {
  /** Σ zaplanowanych godzin zadania (`taskPlannedTotal`). */
  planned: number;
  /** `Task.estimatedHours` — `null` znaczy „brak celu”. */
  estimate: number | null;
  /**
   * Stan z selektora (`taskPlanningStatus`). Pasek zna tylko parę
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
 * Cienki pasek rozplanowania godzin + istniejący tekst godzin. Zastąpił
 * pigułkę `.planning-badge` w wierszach list (ta zostaje w TaskModalu, gdzie
 * żyją szczegóły). Cała arytmetyka siedzi w `utils/planningProgress.ts` —
 * tutaj jest wyłącznie DOM.
 */
export function PlanningProgress({ planned, estimate, status, showHours = true }: Props) {
  const view = planningProgress(planned, estimate);
  const body = (
    <>
      {view.ratio === null ? (
        // Bez szacunku procent nie ma sensu: żadnego paska ani `progressbar`,
        // tylko tekst dla czytnika ekranu.
        <span className="sr-only">{view.label}</span>
      ) : (
        <span
          className="planning-progress-bar"
          data-tone={view.tone}
          role="progressbar"
          aria-label={view.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.percent)}
        >
          <span className="planning-progress-fill" style={{ width: `${view.percent}%` }} />
        </span>
      )}
      {status !== undefined && <span className="sr-only">Stan planowania: {status}</span>}
    </>
  );
  // Bez tekstu godzin nie ma czego opakowywać: sam pasek (albo, przy braku
  // szacunku, sam `.sr-only`) idzie prosto do wiersza wywołującego, więc pusty
  // wariant nie zostawia po sobie odstępu w jego siatce/flexie.
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
