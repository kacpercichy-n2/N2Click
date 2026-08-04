// Content Plan — czysta warstwa widoku „Glass" (port wyglądu 1:1 z aplikacji
// źródłowej `Content plan/planner`, decyzja operatora 2026-08-04): kolory i
// etapy statusów, ciągła oś tygodni pod poziomą tablicę oraz grupowanie
// publikacji w tygodnie dla trybu „Rejestr". Zero Reacta, zero store'u —
// wszystko testowalne w node (jak `contentPlanCalendar.ts`).
//
// GRANICE
// - Arytmetyka dat stoi na `utils/dates.ts` (parseDate/toDateStr/addDaysStr);
//   tutaj żyje wyłącznie pojęcie TYGODNIA PON-ND, którego reszta aplikacji nie
//   używa jako jednostki nawigacji.
// - Kolory statusów są warstwą PREZENTACJI: domena (`domain.ts`) zna tylko
//   nazwy. Paleta przeniesiona 1:1 z `planner/src/data/meta.js` i zmapowana na
//   siedem polskich statusów modułu.
import type { ContentPlanPost, ContentPlanStatus, DateStr } from '../types';
import { addDaysStr, parseDate, toDateStr } from '../utils/dates';
import { monthKeyLabel, monthKeyOf, shiftMonthKey } from './domain';

// ---- Statusy: kolor i etap workflow -----------------------------------------

export interface ContentPlanStatusMeta {
  /** Kolor akcentu (legenda, glow karty, pigułka rejestru). */
  color: string;
  /** Pozycja na pasku postępu „etap X z 7" (kolejność pracy, nie prezentacji). */
  step: number;
}

/** Paleta z aplikacji źródłowej zmapowana na statusy modułu. */
export const CONTENT_PLAN_STATUS_META: Record<ContentPlanStatus, ContentPlanStatusMeta> = {
  'W trakcie tworzenia': { color: '#f59e0b', step: 1 },
  'Do akceptacji': { color: '#8b5cf6', step: 2 },
  Uwagi: { color: '#ffc857', step: 3 },
  'Wdrażane poprawki': { color: '#ef4444', step: 4 },
  Akceptacja: { color: '#10b981', step: 5 },
  Zaplanowane: { color: '#0ea5e9', step: 6 },
  Opublikowano: { color: '#22c55e', step: 7 },
};

export const CONTENT_PLAN_STATUS_STEPS = 7;

// ---- Oś tygodni (pon-nd) -----------------------------------------------------

export interface ContentPlanWeekDay {
  date: DateStr;
  day: number;
}

export interface ContentPlanWeek {
  /** Poniedziałek tygodnia — stabilny klucz renderu. */
  start: DateStr;
  days: ContentPlanWeekDay[];
  /** Dominujący miesiąc tygodnia ('yyyy-MM') — rozstrzyga czwartek, jak w ISO. */
  monthKey: string;
  /** Etykieta zakresu na pigułce paska, np. „17-23". */
  rangeLabel: string;
}

/** Poniedziałek tygodnia, w którym leży `date`. */
export function weekStartOf(date: DateStr): DateStr {
  const offset = (parseDate(date).getDay() + 6) % 7;
  return addDaysStr(date, -offset);
}

/**
 * Ciągła oś tygodni obejmująca wszystkie publikacje ORAZ dzień dzisiejszy,
 * poszerzona o pełne miesiące na brzegach (żeby pierwszy/ostatni tydzień nie
 * urywał kontekstu) — odpowiednik `weeksRange` z aplikacji źródłowej, tyle że
 * zakres wynika z danych, nie ze stałej.
 */
export function contentPlanWeekAxis(
  posts: readonly ContentPlanPost[],
  today: DateStr,
): ContentPlanWeek[] {
  let minKey = monthKeyOf(today);
  let maxKey = monthKeyOf(today);
  for (const post of posts) {
    const key = monthKeyOf(post.date);
    if (key === '') continue;
    if (key < minKey) minKey = key;
    if (key > maxKey) maxKey = key;
  }
  // Miesiąc zapasu z przodu: planowanie zawsze patrzy w przód.
  maxKey = shiftMonthKey(maxKey, 1);
  const from = weekStartOf(`${minKey}-01` as DateStr);
  const lastMonthStart = parseDate(`${maxKey}-01` as DateStr);
  lastMonthStart.setMonth(lastMonthStart.getMonth() + 1);
  lastMonthStart.setDate(0); // ostatni dzień `maxKey`
  const to = toDateStr(lastMonthStart);

  const weeks: ContentPlanWeek[] = [];
  for (let start = from; start <= to; start = addDaysStr(start, 7)) {
    const days: ContentPlanWeekDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDaysStr(start, i);
      days.push({ date, day: parseDate(date).getDate() });
    }
    weeks.push({
      start,
      days,
      monthKey: monthKeyOf(days[3].date),
      rangeLabel: `${days[0].day}-${days[6].day}`,
    });
  }
  return weeks;
}

/** Indeks tygodnia zawierającego datę (fallback: pierwszy tydzień). */
export function weekIndexOf(weeks: readonly ContentPlanWeek[], date: DateStr): number {
  const start = weekStartOf(date);
  const index = weeks.findIndex((week) => week.start === start);
  return index === -1 ? 0 : index;
}

/** Publikacje po dacie, w każdej dacie posortowane po tytule (posty modułu nie
 *  niosą godziny — stabilny porządek dnia daje tytuł). */
export function contentPlanPostsByDate(
  posts: readonly ContentPlanPost[],
): Map<DateStr, ContentPlanPost[]> {
  const map = new Map<DateStr, ContentPlanPost[]>();
  for (const post of posts) {
    const bucket = map.get(post.date);
    if (bucket) bucket.push(post);
    else map.set(post.date, [post]);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  }
  return map;
}

// ---- Rejestr: tygodnie jako separatory ---------------------------------------

export interface ContentPlanRegisterWeek {
  start: DateStr;
  /** Etykieta separatora, np. „6-12 lipiec 2026". */
  label: string;
  posts: ContentPlanPost[];
}

/** Publikacje pogrupowane w tygodnie pon-nd (puste tygodnie odpadają),
 *  posortowane chronologicznie — model wierszy trybu „Rejestr". */
export function contentPlanRegisterWeeks(
  posts: readonly ContentPlanPost[],
): ContentPlanRegisterWeek[] {
  const sorted = [...posts].sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pl'),
  );
  const byWeek = new Map<DateStr, ContentPlanPost[]>();
  for (const post of sorted) {
    const start = weekStartOf(post.date);
    const bucket = byWeek.get(start);
    if (bucket) bucket.push(post);
    else byWeek.set(start, [post]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, weekPosts]) => {
      const end = addDaysStr(start, 6);
      const month = monthKeyLabel(monthKeyOf(end)).toLocaleLowerCase('pl-PL');
      return {
        start,
        label: `${parseDate(start).getDate()}-${parseDate(end).getDate()} ${month}`,
        posts: weekPosts,
      };
    });
}

// ---- Liczniki statusów (legenda i flagi rejestru) ----------------------------

/** Ile publikacji ma dany status; statusy bez publikacji odpadają. */
export function contentPlanStatusCounts(
  posts: readonly ContentPlanPost[],
): Map<ContentPlanStatus, number> {
  const counts = new Map<ContentPlanStatus, number>();
  for (const post of posts) {
    counts.set(post.status, (counts.get(post.status) ?? 0) + 1);
  }
  return counts;
}
