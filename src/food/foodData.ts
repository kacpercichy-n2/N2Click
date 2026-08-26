// Warstwa danych strony „Jedzenie": granica bazy (wstrzykiwany `FoodDb`),
// łagodne mapowanie jsonb → typy domenowe i operacje (menu dnia, kierowcy,
// złożenie i anulowanie zamówienia, moje zamówienia). Zero Reacta; SDK zna
// wyłącznie `createSupabaseFoodDb`. Testy w node: `foodData.test.ts`.
//
// GRANICE / INVARIANTY:
//   * Backend to schemat `blogoapp` TEGO SAMEGO projektu Supabase (N2Hub),
//     dostępny WYŁĄCZNIE przez RPC nadane `authenticated`. Główny klient
//     zostaje przypięty do `n2click`. `client.schema('blogoapp')` przepina
//     tylko zapytania tego adaptera, więc NIE powstaje drugi `createClient`
//     (ten sam wzorzec co `createSupabaseContentPlanDb` w plannerData).
//   * Błędy wracają jako polski komunikat. Baza rzuca po polsku
//     (`raise exception 'Wybierz aktywnego kierowcę.'`), więc jej tekst idzie
//     do użytkownika bez zmian; brak tekstu dostaje zapasowy komunikat.
//   * Mapowanie jest ŁAGODNE: pozycja albo zamówienie nie do odczytania jest
//     POMIJANE, nigdy nie wyrzuca wyjątku.
//   * Ten moduł nie dotyka localStorage ani reduktora aplikacji.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isFoodOrderStatus,
  sortOrdersNewestFirst,
  type FoodDriver,
  type FoodMenu,
  type FoodMenuItem,
  type FoodOrder,
  type FoodOrderLine,
  type FoodOrderLineInput,
  type FoodOrderResponse,
} from './foodModel';

// ---- Granica bazy (wstrzykiwana) --------------------------------------------

export interface FoodDbError {
  code: string | null;
  message: string;
}

export interface FoodDb {
  /** Wywołanie RPC w schemacie `blogoapp`; `data` to surowe jsonb. */
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: FoodDbError | null }>;
}

export type FoodResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Nazwa schematu bramki zamówień (BłogoSELL). */
export const FOOD_SCHEMA_NAME = 'blogoapp';

export const FOOD_ERRORS = {
  menu: 'Nie udało się wczytać menu.',
  drivers: 'Nie udało się wczytać listy kierowców.',
  orders: 'Nie udało się wczytać zamówień.',
  place: 'Nie udało się złożyć zamówienia.',
  cancel: 'Nie udało się anulować zamówienia.',
} as const;

function toDbError(error: unknown, fallback: string): FoodDbError {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === 'string' ? e.code : null,
      message: typeof e.message === 'string' && e.message.trim() ? e.message : fallback,
    };
  }
  return { code: null, message: error instanceof Error ? error.message : fallback };
}

/** Cienki adapter nad klientem Supabase, jedyne miejsce, które zna SDK. */
export function createSupabaseFoodDb(client: SupabaseClient): FoodDb {
  // `schema()` zwraca klienta PostgREST z tym samym `rpc()`; rzutowanie, bo
  // repo nie ma wygenerowanych typów bazy (wszystko `any`).
  const scoped = client.schema(FOOD_SCHEMA_NAME) as unknown as SupabaseClient;
  return {
    async rpc(name, args) {
      try {
        const { data, error } = await scoped.rpc(name, args);
        if (error) return { data: null, error: toDbError(error, 'Błąd zapytania.') };
        return { data: data as unknown, error: null };
      } catch (e) {
        return { data: null, error: toDbError(e, 'Błąd zapytania.') };
      }
    },
  };
}

// ---- Mapowanie jsonb → model (łagodne) --------------------------------------

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Liczby z jsonb przychodzą jako number albo string (numeric). */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toFoodMenuItem(raw: unknown): FoodMenuItem | null {
  const r = asRecord(raw);
  if (!r) return null;
  const dishId = asString(r.dish_id);
  const name = asString(r.name);
  const price = asNumber(r.price);
  const employeePrice = asNumber(r.employee_price);
  if (!dishId || !name || price === null || employeePrice === null) return null;
  const category = asString(r.category) ?? '';
  return {
    dishId,
    name,
    category,
    categoryLabel: asString(r.category_label) ?? category,
    price,
    employeePrice,
  };
}

export function toFoodMenu(raw: unknown, fallbackDate: string): FoodMenu {
  const r = asRecord(raw);
  const items = Array.isArray(r?.items)
    ? r.items.map(toFoodMenuItem).filter((i): i is FoodMenuItem => i !== null)
    : [];
  return {
    date: asString(r?.date) ?? fallbackDate,
    published: r?.published === true && items.length > 0,
    employeeDiscountPercent: asNumber(r?.employee_discount_percent) ?? 0,
    items,
  };
}

export function toFoodDriver(raw: unknown): FoodDriver | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = asString(r.id);
  const fullName = asString(r.full_name);
  if (!id || !fullName) return null;
  return { id, fullName };
}

function toOrderLine(raw: unknown): FoodOrderLine | null {
  const r = asRecord(raw);
  if (!r) return null;
  const dishId = asString(r.dish_id);
  const qty = asNumber(r.qty);
  if (!dishId || qty === null) return null;
  return {
    dishId,
    name: asString(r.name) ?? '',
    qty,
    unitPrice: asNumber(r.unit_price) ?? 0,
  };
}

function toOrderResponse(raw: unknown): FoodOrderResponse | null {
  const r = asRecord(raw);
  if (!r) return null;
  const response = asString(r.response);
  if (!response) return null;
  return {
    driverName: asString(r.driver_name) ?? '',
    response,
    note: asString(r.note),
    respondedAt: asString(r.responded_at),
  };
}

export function toFoodOrder(raw: unknown): FoodOrder | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = asString(r.id);
  const forDate = asString(r.for_date);
  const createdAt = asString(r.created_at);
  if (!id || !forDate || !createdAt || !isFoodOrderStatus(r.status)) return null;
  return {
    id,
    title: asString(r.title) ?? '',
    body: asString(r.body) ?? '',
    forDate,
    lines: Array.isArray(r.lines)
      ? r.lines.map(toOrderLine).filter((l): l is FoodOrderLine => l !== null)
      : [],
    status: r.status,
    acceptedByName: asString(r.accepted_by_name),
    acceptedAt: asString(r.accepted_at),
    responses: Array.isArray(r.responses)
      ? r.responses.map(toOrderResponse).filter((x): x is FoodOrderResponse => x !== null)
      : [],
    createdAt,
  };
}

// ---- Operacje ---------------------------------------------------------------

/** RPC `food_menu_for_date(p_date)`: menu dnia z ceną pełną i pracowniczą. */
export async function loadMenu(db: FoodDb, date: string): Promise<FoodResult<FoodMenu>> {
  const { data, error } = await db.rpc('food_menu_for_date', { p_date: date });
  if (error) return { ok: false, error: error.message || FOOD_ERRORS.menu };
  return { ok: true, value: toFoodMenu(data, date) };
}

/** RPC `food_order_drivers()`: aktywni kierowcy do wyboru. */
export async function loadDrivers(db: FoodDb): Promise<FoodResult<FoodDriver[]>> {
  const { data, error } = await db.rpc('food_order_drivers');
  if (error) return { ok: false, error: error.message || FOOD_ERRORS.drivers };
  const drivers = Array.isArray(data)
    ? data.map(toFoodDriver).filter((d): d is FoodDriver => d !== null)
    : [];
  return { ok: true, value: drivers };
}

export interface PlaceOrderInput {
  forDate: string;
  driverId: string;
  lines: FoodOrderLineInput[];
  note: string;
  requesterName: string;
}

/** RPC `place_food_order(...)`: zwraca nowe zadanie kierowcy (zamówienie). */
export async function placeOrder(
  db: FoodDb,
  input: PlaceOrderInput,
): Promise<FoodResult<FoodOrder>> {
  const { data, error } = await db.rpc('place_food_order', {
    p_for_date: input.forDate,
    p_driver_id: input.driverId,
    p_lines: input.lines,
    p_note: input.note.trim() === '' ? null : input.note.trim(),
    p_requester_name: input.requesterName.trim() === '' ? null : input.requesterName.trim(),
    p_app: 'n2click',
  });
  if (error) return { ok: false, error: error.message || FOOD_ERRORS.place };
  const order = toFoodOrder(data);
  if (!order) return { ok: false, error: FOOD_ERRORS.place };
  return { ok: true, value: order };
}

/** RPC `my_food_orders(p_from)`: zamówienia zalogowanego, najnowsze u góry.
 *  `from = null` zostawia domyślne okno bazy (ostatnie 7 dni i dalej). */
export async function loadMyOrders(
  db: FoodDb,
  from: string | null = null,
): Promise<FoodResult<FoodOrder[]>> {
  const { data, error } = await db.rpc('my_food_orders', { p_from: from });
  if (error) return { ok: false, error: error.message || FOOD_ERRORS.orders };
  const orders = Array.isArray(data)
    ? data.map(toFoodOrder).filter((o): o is FoodOrder => o !== null)
    : [];
  return { ok: true, value: sortOrdersNewestFirst(orders) };
}

/** RPC `cancel_driver_task(p_task_id)`: tylko otwarte, tylko własne. */
export async function cancelOrder(db: FoodDb, id: string): Promise<FoodResult<FoodOrder>> {
  const { data, error } = await db.rpc('cancel_driver_task', { p_task_id: id });
  if (error) return { ok: false, error: error.message || FOOD_ERRORS.cancel };
  const order = toFoodOrder(data);
  if (!order) return { ok: false, error: FOOD_ERRORS.cancel };
  return { ok: true, value: order };
}

/**
 * Anulowanie + świeża lista. Lista jest przeładowywana ZAWSZE, także po
 * błędzie anulowania: typowy powód odmowy to zmiana statusu po stronie
 * kierowcy (przyjął, odrzucił), więc widok musi pokazać stan z bazy, a nie
 * przestarzały. Tekst błędu z bazy wraca bez zmian w `cancel.error`.
 */
export async function cancelOrderAndReload(
  db: FoodDb,
  id: string,
): Promise<{ cancel: FoodResult<FoodOrder>; orders: FoodResult<FoodOrder[]> }> {
  const cancel = await cancelOrder(db, id);
  const orders = await loadMyOrders(db);
  return { cancel, orders };
}
