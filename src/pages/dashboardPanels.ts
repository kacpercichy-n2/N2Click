// Pure display helpers behind the Panel (DashboardPage) tiles. No React, no
// store access — just the rules the page needs so the JSX stays declarative and
// the logic is unit-testable (mirrors the kanbanBoard.ts pattern).
//
// Rules encoded here:
// - Powiadomienia renders at most `MAX_NOTIFICATIONS` UNREAD entries; the page
//   feeds it `unreadNotificationsForPerson` mapped through `notificationEntry`.
// - The Zespół header shows a counter only when there is at least one coworker:
//   `Zespół` with 0, `Zespół (N)` otherwise.
// - A collapsible tile (Powiadomienia, Alerty) with nothing to show renders as a
//   one-line bar instead of a full card (`dashTileView`); the Zasobnik CTA names
//   the actual work to plan (`binPlanCtaLabel`).
// - Below the phone breakpoint the Panel is a purpose-ordered STACK, not the
//   desktop grid: `mobileDashboardOrder` owns both the order and the emptiness
//   rule (a tile whose whole content would be an empty-state sentence is not
//   rendered at all), `workloadSummaryLine` replaces the two donuts with one
//   line. Desktop composition is untouched by this module.
import type { Notification } from '../types';
import { formatDuration } from '../utils/time';

/** Dokąd prowadzi klik w powiadomienie: zadanie (modal) albo projekt (route). */
export type NotificationTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'project'; projectId: string };

/** Rozwinięty podgląd wiersza powiadomienia (kto / co / gdzie [+ treść]). */
export interface NotificationPreview {
  who: string; // aktor albo „Ktoś”
  what: string; // czego dotyczy (tytuł zadania / nazwa projektu)
  where: string; // projekt albo „—”
  /** Treść komentarza — tylko dla `project_comment`, gdy jest dostępna. */
  body?: string;
}

/** A single notification row prepared for display (Polish title + click target).
 *  Klik w wiersz ROZWIJA `preview` (nic nie dispatchuje — kafelek pokazuje tylko
 *  nieprzeczytane, więc auto-oznaczanie usunęłoby wiersz w trakcie czytania);
 *  otwarcie encji jest osobną akcją opisaną przez `openLabel`. */
export interface NotificationEntry {
  id: string;
  title: string;
  when?: string;
  target?: NotificationTarget;
  preview: NotificationPreview;
  /** Etykieta akcji wtórnej; `undefined` = brak celu, przycisk ukryty. */
  openLabel?: string;
}

/** Nazwy encji rozwiązane przez wołającego (selektory), wstrzyknięte do czystego
 *  buildera treści — pusty string = encja nieznana (fallback niżej). */
export interface NotificationNames {
  actorName: string;
  taskTitle: string;
  projectName: string;
  /** Treść komentarza rozwiązana przez wołającego; '' = brak/nieznana. */
  commentBody: string;
}

/** Etykieta akcji „otwórz” dla celu kliknięcia (brak celu => brak przycisku). */
function openLabelFor(target: NotificationTarget | undefined): string | undefined {
  if (!target) return undefined;
  return target.kind === 'task' ? 'Otwórz zadanie' : 'Otwórz projekt';
}

/**
 * Buduje polską treść powiadomienia (kto, co, gdzie) + cel kliknięcia z rekordu
 * `Notification` i rozwiązanych nazw. Czyste — testowalne bez store'a. Braki nazw
 * degradują się miękko (aktor => „Ktoś”, encja => „—”).
 */
export function notificationEntry(n: Notification, names: NotificationNames): NotificationEntry {
  const actor = names.actorName.trim() || 'Ktoś';
  const taskTitle = names.taskTitle.trim() || '—';
  const projectName = names.projectName.trim() || '—';
  const projectMeta = names.projectName.trim() || undefined;
  const commentBody = names.commentBody.trim();
  switch (n.type) {
    case 'task_assigned': {
      const target: NotificationTarget | undefined = n.payload.taskId
        ? { kind: 'task', taskId: n.payload.taskId }
        : undefined;
      return {
        id: n.id,
        title: `${actor} przypisał(a) Ci zadanie „${taskTitle}”`,
        when: projectMeta,
        target,
        preview: { who: actor, what: taskTitle, where: projectName },
        openLabel: openLabelFor(target),
      };
    }
    case 'project_comment': {
      const target: NotificationTarget | undefined = n.payload.projectId
        ? { kind: 'project', projectId: n.payload.projectId }
        : undefined;
      return {
        id: n.id,
        title: `${actor} skomentował(a) projekt „${projectName}”`,
        target,
        // Klucz `body` istnieje TYLKO gdy treść komentarza jest znana — nigdy
        // pusty string ani jawne `undefined`.
        preview: {
          who: actor,
          what: projectName,
          where: projectName,
          ...(commentBody ? { body: commentBody } : {}),
        },
        openLabel: openLabelFor(target),
      };
    }
    case 'bin_item': {
      const target: NotificationTarget | undefined = n.payload.taskId
        ? { kind: 'task', taskId: n.payload.taskId }
        : undefined;
      return {
        id: n.id,
        title: `Nowa praca w zasobniku: „${taskTitle}”`,
        when: projectMeta,
        target,
        preview: { who: actor, what: taskTitle, where: projectName },
        openLabel: openLabelFor(target),
      };
    }
  }
}

/** At most this many notification rows are ever shown in the tile. */
export const MAX_NOTIFICATIONS = 3;

/** The notifications actually rendered: the first `MAX_NOTIFICATIONS` entries. */
export function visibleNotifications(
  entries: readonly NotificationEntry[],
): NotificationEntry[] {
  return entries.slice(0, MAX_NOTIFICATIONS);
}

/** Zespół header label: bare when empty, counted otherwise. */
export function teamHeaderLabel(coworkerCount: number): string {
  return coworkerCount > 0 ? `Zespół (${coworkerCount})` : 'Zespół';
}

/** Kafelki, które PUSTE zwijają się do belki zamiast zajmować cały rząd. */
export type CollapsibleTileId = 'notifications' | 'alerts';

/** Jak wyrenderować kafelek zwijalny: pełna karta czy jednolinijkowa belka. */
export interface DashTileView {
  /** true = belka (~40 px, `align-self: start`), false = karta jak dotąd. */
  collapsed: boolean;
  /** Nagłówek: sam tytuł dla karty, tytuł + stan dla belki. */
  label: string;
}

/** Tytuł kafelka (pełna karta) i tekst belki (kafelek pusty). */
const COLLAPSIBLE_TILE_LABELS: Record<CollapsibleTileId, { title: string; empty: string }> = {
  notifications: { title: 'Powiadomienia', empty: 'Powiadomienia — brak nowych' },
  alerts: { title: 'Alerty', empty: 'Alerty — czysto ✓' },
};

/**
 * Decyzja „karta czy belka" dla kafelka zwijalnego (OP-01/TY-33). Pusty kafelek
 * na desktopie nie znika (rząd siatki musi mieć obie kolumny), tylko kurczy się
 * do jednej linii — odzyskana wysokość idzie do „Zadania na dziś"/„Twój tydzień",
 * dzięki czemu „Zasobnik" wchodzi nad zgięcie. Z treścią kafelek renderuje się
 * dokładnie jak dotąd. Na telefonie pusty kafelek nadal NIE trafia do DOM-u
 * (`mobileDashboardOrder`), więc ta funkcja obsługuje tam wyłącznie `collapsed:
 * false`.
 */
export function dashTileView(id: CollapsibleTileId, hasContent: boolean): DashTileView {
  const labels = COLLAPSIBLE_TILE_LABELS[id];
  return hasContent
    ? { collapsed: false, label: labels.title }
    : { collapsed: true, label: labels.empty };
}

/** Najdłuższy tytuł zadania wpuszczony do etykiety CTA (dalej → wielokropek). */
const CTA_TITLE_MAX = 40;

/** Pierwszy wiersz zasobnika, z którego bierze się konkretne CTA planowania. */
export interface BinCtaRow {
  title: string;
  hours: number;
}

/**
 * Etykieta przycisku planowania w kafelku „Zasobnik" (AT-19): zamiast ogólnego
 * „Zaplanuj w kalendarzu" konkret — „Zaplanuj 2h — Montaż". Bez wiersza (pusty
 * zasobnik) albo bez sensownych godzin/tytułu wraca ogólna etykieta, żeby
 * przycisk nigdy nie kłamał o pracy do rozplanowania.
 */
export function binPlanCtaLabel(row?: BinCtaRow): string {
  const title = row?.title.trim() ?? '';
  const hours = row?.hours ?? 0;
  if (!title || !(hours > 0)) return 'Zaplanuj w kalendarzu';
  const short = title.length > CTA_TITLE_MAX ? `${title.slice(0, CTA_TITLE_MAX - 1)}…` : title;
  return `Zaplanuj ${formatDuration(hours)} — ${short}`;
}

/** Every Panel tile that can appear in the phone stack. */
export type DashTileId =
  | 'today'
  | 'alerts'
  | 'notifications'
  | 'workload'
  | 'bin'
  | 'week'
  | 'team';

/** Czy dany kafelek ma cokolwiek do pokazania (liczone przez stronę z selektorów). */
export interface MobileDashFlags {
  hasToday: boolean;
  hasAlerts: boolean;
  hasNotifications: boolean;
  hasBin: boolean;
  hasCoworkers: boolean;
}

/** Kolejność „po co tu jestem”: najpierw dziś, potem to, co wymaga uwagi,
 *  potem obraz obciążenia, praca do rozplanowania, tydzień i na końcu zespół. */
const MOBILE_TILE_ORDER: readonly DashTileId[] = [
  'today',
  'alerts',
  'notifications',
  'workload',
  'bin',
  'week',
  'team',
];

/**
 * Kafelki telefonu w kolejności renderowania. Kafelek, którego CAŁA treść byłaby
 * tylko zdaniem pustego stanu („Brak alertów”, „Zasobnik jest pusty”…), znika z
 * DOM-u zamiast spychać treść w dół — dlatego to lista, nie CSS `order`.
 * `workload` i `week` nie mają pustego stanu (zawsze niosą liczby / siedem dni),
 * więc renderują się zawsze.
 */
export function mobileDashboardOrder(flags: MobileDashFlags): DashTileId[] {
  const shows: Record<DashTileId, boolean> = {
    today: flags.hasToday,
    alerts: flags.hasAlerts,
    notifications: flags.hasNotifications,
    workload: true,
    bin: flags.hasBin,
    week: true,
    team: flags.hasCoworkers,
  };
  return MOBILE_TILE_ORDER.filter((id) => shows[id]);
}

/** Jeden odcinek linii obciążenia: zabukowane / dostępne + stan przeciążenia. */
export interface WorkloadSegment {
  booked: number;
  available: number;
  /** Ta sama semantyka niebezpieczeństwa co w pierścieniach (patrz DashboardPage). */
  over: boolean;
}

/** „Dziś 4h / 8h” — z prefiksem „⚠ ”, gdy odcinek jest przeciążony. */
function segmentLabel(label: string, seg: WorkloadSegment): string {
  const prefix = seg.over ? '⚠ ' : '';
  return `${prefix}${label} ${formatDuration(seg.booked)} / ${formatDuration(seg.available)}`;
}

/**
 * Jedna linia zastępująca dwa pierścienie na telefonie:
 * „Dziś 4h / 8h · Ten tydzień 22h / 40h”. Godziny nadal pochodzą wyłącznie z
 * wyliczeń wołającego (selektory nad `WorkloadEntry`) — ten moduł nic nie liczy
 * ani nie przechowuje, tylko formatuje.
 */
export function workloadSummaryLine(today: WorkloadSegment, week: WorkloadSegment): string {
  return `${segmentLabel('Dziś', today)} · ${segmentLabel('Ten tydzień', week)}`;
}
