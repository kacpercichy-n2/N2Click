// Czysta geometria paska rozplanowania godzin (lista zadań, karta projektu,
// Panel). Bez Reacta i bez store'a — wejściem są dwie liczby, wyjściem ułamek,
// przycięta szerokość, ton i polska etykieta dla czytnika ekranu.
//
// To jest WARSTWA PREZENTACJI, a nie podmiana selektora: `planningStatusForTotals`
// / `taskPlanningStatus` (`src/store/selectors.ts`) dalej rządzą etykietą stanu
// planowania (w tym niuansem zasobnika, o którym para „zaplanowane / szacunek”
// nic nie wie). Dlatego komponent renderujący pasek dostaje status z selektora
// osobno i dokłada go do tekstu dla czytnika ekranu.
import { formatDuration } from './time';

/** Ton paska — steruje WYŁĄCZNIE kolorem wypełnienia. */
export type PlanningProgressTone = 'none' | 'under' | 'full' | 'over';

/**
 * Tolerancja dryfu zmiennoprzecinkowego — ta sama wartość co `PLANNING_EPS`
 * w `src/store/selectors.ts` (celowo zduplikowana STAŁA, a nie import, żeby ten
 * moduł nie ciągnął store'a). Godziny i tak zatrzaskują się do 0,25 h na
 * ścieżkach zapisu, więc epsilon łapie tylko szum binarny (0,1 + 0,2 ≠ 0,3).
 */
export const PROGRESS_EPS = 1e-9;

export interface PlanningProgressView {
  /**
   * `planned / estimate`, albo `null` gdy szacunku NIE MA (brak / `<= 0`) —
   * wtedy procent nie ma sensu i pasek nie dostaje wypełnienia ani
   * `role="progressbar"`.
   */
  ratio: number | null;
  /** Szerokość wypełnienia w procentach, PRZYCIĘTA do 0–100 (przepełnienie nie
   * rozpycha paska). Zawsze skończona liczba — nigdy NaN. */
  percent: number;
  tone: PlanningProgressTone;
  /** Polski tekst dla czytnika ekranu (patrz {@link planningProgressLabel}). */
  label: string;
}

/** Godziny zaplanowane: brak / NaN / wartość ujemna degradują miękko do 0. */
function safePlanned(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value > 0 ? value : 0;
}

/** Szacunek: brak / NaN / `<= 0` znaczą „nie ma celu”, czyli `null`. */
function safeEstimate(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value > 0 ? value : null;
}

/**
 * Etykieta dla czytnika ekranu:
 * - z szacunkiem → „Zaplanowano 45h z 40h (113%)”,
 * - bez szacunku → „Zaplanowano 45h, brak szacunku”.
 * Procent w etykiecie NIE jest przycinany (113% ma być słyszalne), w
 * przeciwieństwie do szerokości wypełnienia.
 */
export function planningProgressLabel(
  planned: number | null | undefined,
  estimate: number | null | undefined,
): string {
  const hours = safePlanned(planned);
  const target = safeEstimate(estimate);
  if (target === null) return `Zaplanowano ${formatDuration(hours)}, brak szacunku`;
  const percent = Math.round((hours / target) * 100);
  return `Zaplanowano ${formatDuration(hours)} z ${formatDuration(target)} (${percent}%)`;
}

/**
 * Stan paska z pary (godziny zaplanowane, szacunek).
 *
 * Ton:
 * - `none` — nic nie zaplanowano (0 h), niezależnie od szacunku,
 * - `under` — `0 < ratio < 1`,
 * - `full` — `ratio ≈ 1` (z tolerancją {@link PROGRESS_EPS}) ORAZ przypadek
 *   „są godziny, nie ma szacunku” — nie ma celu, którego można nie dowieźć
 *   (ta sama logika co reguła 4 w `planningStatusForTotals`),
 * - `over` — `ratio > 1`; jedyny ton ostrzegawczy (AT-16).
 */
export function planningProgress(
  planned: number | null | undefined,
  estimate: number | null | undefined,
): PlanningProgressView {
  const hours = safePlanned(planned);
  const target = safeEstimate(estimate);
  const label = planningProgressLabel(planned, estimate);

  if (target === null) {
    return { ratio: null, percent: 0, tone: hours > PROGRESS_EPS ? 'full' : 'none', label };
  }

  const ratio = hours / target;
  const percent = Math.round(Math.min(100, Math.max(0, ratio * 100)) * 10) / 10;
  let tone: PlanningProgressTone;
  if (hours <= PROGRESS_EPS) tone = 'none';
  else if (ratio > 1 + PROGRESS_EPS) tone = 'over';
  else if (ratio >= 1 - PROGRESS_EPS) tone = 'full';
  else tone = 'under';

  return { ratio, percent, tone, label };
}
