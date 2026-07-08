// Shared, pure UI helpers for the person forms (PeoplePage + PersonProfilePage):
// weekday chips, work-hour select options, and compact work-day formatting.
// No store/selector logic here — just presentational constants + pure functions.

/** Weekday toggle chips in ISO order (Mon=1 … Sun=7). */
export const WEEKDAY_CHIPS: Array<{ iso: number; label: string }> = [
  { iso: 1, label: 'Pn' },
  { iso: 2, label: 'Wt' },
  { iso: 3, label: 'Śr' },
  { iso: 4, label: 'Cz' },
  { iso: 5, label: 'Pt' },
  { iso: 6, label: 'So' },
  { iso: 7, label: 'Nd' },
];

/** Start-of-work options: 0:00 … 23:45 (15-min steps). */
export const START_MINUTE_OPTIONS: number[] = Array.from(
  { length: 96 },
  (_, i) => i * 15,
);

/** End-of-work options: 0:15 … 24:00 (15-min steps; 24:00 = 1440). */
export const END_MINUTE_OPTIONS: number[] = Array.from(
  { length: 96 },
  (_, i) => (i + 1) * 15,
);

/** Toggle an ISO weekday in/out of a work-days list, kept sorted ascending. */
export function toggleWorkDay(workDays: number[], iso: number): number[] {
  return workDays.includes(iso)
    ? workDays.filter((d) => d !== iso)
    : [...workDays, iso].sort((a, b) => a - b);
}

/**
 * Compact work-day summary: '—' when empty, a single chip label for one day, a
 * range 'Pn–Pt' for a contiguous run, else a comma list ('Pn, Śr, Pt').
 */
export function formatWorkDays(workDays: number[]): string {
  const sorted = [...new Set(workDays)].sort((a, b) => a - b);
  if (sorted.length === 0) return '—';
  const label = (iso: number) => WEEKDAY_CHIPS.find((c) => c.iso === iso)?.label ?? '';
  if (sorted.length === 1) return label(sorted[0]);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous) return `${label(sorted[0])}–${label(sorted[sorted.length - 1])}`;
  return sorted.map(label).join(', ');
}
