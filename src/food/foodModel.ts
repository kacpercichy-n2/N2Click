// Czysty model strony „Jedzenie": typy domenowe zamówień pracowniczych,
// domyślna data zamówienia, kwoty w PLN, etykiety statusów i pomocnicy
// formularza. Zero Reacta, zero SDK. Testy w node: `foodModel.test.ts`.
//
// Źródło prawdy kontraktu: RPC schematu `blogoapp` (BłogoSELL, migracja
// 20260826120000_blogoapp_driver_tasks.sql, sekcja 6). Ceny liczy BAZA
// (cena pracownicza wchodzi w linie zamówienia po stronie serwera); tutejsze
// sumy są wyłącznie podglądem dla użytkownika przed wysłaniem.
import { addDaysStr, parseDate, toDateStr } from '../utils/dates';
import type { DateStr } from '../types';

// ---- Typy domenowe ----------------------------------------------------------

export interface FoodMenuItem {
  dishId: string;
  name: string;
  category: string;
  categoryLabel: string;
  /** Cena pełna (katalogowa). */
  price: number;
  /** Cena pracownicza po rabacie, policzona przez bazę. */
  employeePrice: number;
}

export interface FoodMenu {
  date: DateStr;
  published: boolean;
  employeeDiscountPercent: number;
  items: FoodMenuItem[];
}

export interface FoodDriver {
  id: string;
  fullName: string;
}

export type FoodOrderStatus = 'open' | 'accepted' | 'rejected' | 'cancelled' | 'done';

export const FOOD_ORDER_STATUSES: readonly FoodOrderStatus[] = [
  'open',
  'accepted',
  'rejected',
  'cancelled',
  'done',
];

export function isFoodOrderStatus(value: unknown): value is FoodOrderStatus {
  return typeof value === 'string' && (FOOD_ORDER_STATUSES as readonly string[]).includes(value);
}

export interface FoodOrderLine {
  dishId: string;
  name: string;
  qty: number;
  /** Cena jednostkowa zapisana w zamówieniu (pracownicza). */
  unitPrice: number;
}

export interface FoodOrderResponse {
  driverName: string;
  response: string;
  note: string | null;
  respondedAt: string | null;
}

export interface FoodOrder {
  id: string;
  title: string;
  body: string;
  forDate: DateStr;
  lines: FoodOrderLine[];
  status: FoodOrderStatus;
  acceptedByName: string | null;
  acceptedAt: string | null;
  responses: FoodOrderResponse[];
  createdAt: string;
}

/** Grupa pozycji menu pod wspólną etykietą kategorii (kolejność z bazy). */
export interface FoodMenuGroup {
  category: string;
  label: string;
  items: FoodMenuItem[];
}

/** Linia w kształcie RPC `place_food_order(p_lines)`. */
export interface FoodOrderLineInput {
  dish_id: string;
  qty: number;
}

// ---- Data zamówienia --------------------------------------------------------

/** Maksymalna liczba sztuk jednej pozycji w stepperze (baza dopuszcza 50). */
export const FOOD_MAX_QTY = 10;

/**
 * Domyślny dzień zamówienia: NASTĘPNY dzień roboczy. Catering nie wozi
 * w weekend, więc sobota i niedziela przeskakują na poniedziałek
 * (piątek → poniedziałek, sobota → poniedziałek, niedziela → poniedziałek).
 * `today` jest wstrzykiwane, żeby test nie zależał od zegara.
 */
export function defaultOrderDate(today: Date = new Date()): DateStr {
  const tomorrow = addDaysStr(toDateStr(today), 1);
  const day = parseDate(tomorrow).getDay(); // 0 = niedziela, 6 = sobota
  if (day === 6) return addDaysStr(tomorrow, 2);
  if (day === 0) return addDaysStr(tomorrow, 1);
  return tomorrow;
}

/** Zamówienia przyjmujemy tylko na dni robocze (przeglądać menu można zawsze). */
export function isOrderableDate(date: DateStr): boolean {
  const day = parseDate(date).getDay();
  return day !== 0 && day !== 6;
}

// ---- Kwoty ------------------------------------------------------------------

/** Kwota w PLN po polsku: „12,50 zł". Zawsze dwa miejsca po przecinku. */
export function formatPln(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toFixed(2).replace('.', ',')} zł`;
}

/** Wartość jednej linii (sztuki × cena jednostkowa), zaokrąglona do groszy. */
export function lineTotal(qty: number, unitPrice: number): number {
  return Math.round(qty * unitPrice * 100) / 100;
}

/** Suma linii zamówienia (albo koszyka) w groszowej dokładności. */
export function orderTotal(lines: ReadonlyArray<{ qty: number; unitPrice: number }>): number {
  const cents = lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitPrice * 100), 0);
  return cents / 100;
}

// ---- Statusy ----------------------------------------------------------------

/** Etykieta statusu zamówienia do listy „Moje zamówienia". */
export function orderStatusLabel(order: Pick<FoodOrder, 'status' | 'acceptedByName'>): string {
  switch (order.status) {
    case 'open':
      return 'Czeka na kierowcę';
    case 'accepted':
      return order.acceptedByName ? `Przyjął: ${order.acceptedByName}` : 'Przyjęte';
    case 'rejected':
      return 'Odrzucone';
    case 'cancelled':
      return 'Anulowane';
    case 'done':
      return 'Zrealizowane';
  }
}

/** Ton pigułki statusu (kolor bierze CSS przez `data-tone`). */
export function orderStatusTone(
  status: FoodOrderStatus,
): 'pending' | 'success' | 'danger' | 'muted' {
  switch (status) {
    case 'open':
      return 'pending';
    case 'accepted':
    case 'done':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'cancelled':
      return 'muted';
  }
}

// ---- Pomocnicy formularza ---------------------------------------------------

/** Pozycje menu pogrupowane po kategorii, w kolejności z bazy. */
export function groupMenuItems(items: readonly FoodMenuItem[]): FoodMenuGroup[] {
  const groups: FoodMenuGroup[] = [];
  const byCategory = new Map<string, FoodMenuGroup>();
  for (const item of items) {
    let group = byCategory.get(item.category);
    if (!group) {
      group = { category: item.category, label: item.categoryLabel, items: [] };
      byCategory.set(item.category, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** Sztuki w stepperze: liczba całkowita w przedziale 0..FOOD_MAX_QTY. */
export function clampQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(FOOD_MAX_QTY, Math.max(0, Math.trunc(value)));
}

/** Koszyk (dish_id → sztuki) do linii RPC; zera i pozycje spoza menu odpadają. */
export function buildOrderLines(
  quantities: Readonly<Record<string, number>>,
  menu: readonly FoodMenuItem[],
): FoodOrderLineInput[] {
  const lines: FoodOrderLineInput[] = [];
  for (const item of menu) {
    const qty = clampQty(quantities[item.dishId] ?? 0);
    if (qty > 0) lines.push({ dish_id: item.dishId, qty });
  }
  return lines;
}

/** Podgląd sumy koszyka w cenie pracowniczej (to samo liczy potem baza). */
export function cartTotal(
  quantities: Readonly<Record<string, number>>,
  menu: readonly FoodMenuItem[],
): number {
  return orderTotal(
    menu.map((item) => ({ qty: clampQty(quantities[item.dishId] ?? 0), unitPrice: item.employeePrice })),
  );
}

/** Przycisk „Zamów" jest aktywny dopiero z co najmniej jedną linią i kierowcą. */
export function canPlaceOrder(lines: readonly FoodOrderLineInput[], driverId: string): boolean {
  return lines.length > 0 && driverId.trim() !== '';
}

/** Najnowsze zamówienia u góry (po `createdAt`, potem po id dla stabilności). */
export function sortOrdersNewestFirst(orders: readonly FoodOrder[]): FoodOrder[] {
  return [...orders].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Wstawia albo podmienia zamówienie w liście i zwraca ją posortowaną. */
export function upsertOrder(orders: readonly FoodOrder[], order: FoodOrder): FoodOrder[] {
  const rest = orders.filter((o) => o.id !== order.id);
  return sortOrdersNewestFirst([...rest, order]);
}

/** Nazwa zleceniodawcy: osoba z magazynu, w zapasie e-mail sesji. */
export function requesterDisplayName(
  personName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = personName?.trim() ?? '';
  if (name) return name;
  return email?.trim() ?? '';
}
