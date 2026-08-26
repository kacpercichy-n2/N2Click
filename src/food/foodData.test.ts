// Testy warstwy danych „Jedzenie" na atrapie granicy bazy (`FoodDb`): nazwy
// i argumenty RPC, łagodne mapowanie jsonb, polskie błędy z bazy.
import { describe, expect, it } from 'vitest';
import {
  FOOD_ERRORS,
  cancelOrder,
  cancelOrderAndReload,
  loadDrivers,
  loadMenu,
  loadMyOrders,
  placeOrder,
  toFoodMenu,
  toFoodOrder,
  type FoodDb,
  type FoodDbError,
} from './foodData';

interface Call {
  name: string;
  args: Record<string, unknown> | undefined;
}

function fakeDb(
  respond: (name: string, args?: Record<string, unknown>) => unknown,
  error: FoodDbError | null = null,
): { db: FoodDb; calls: Call[] } {
  const calls: Call[] = [];
  const db: FoodDb = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (error) return { data: null, error };
      return { data: respond(name, args), error: null };
    },
  };
  return { db, calls };
}

const MENU_JSON = {
  date: '2026-08-27',
  published: true,
  employee_discount_percent: 50,
  items: [
    {
      dish_id: 'd1',
      name: 'Pomidorowa',
      category: 'zupa',
      category_label: 'Zupy',
      price: '12.00',
      employee_price: '6.00',
    },
    { dish_id: null, name: 'Zepsuta', category: 'zupa' },
  ],
};

const ORDER_JSON = {
  id: 't1',
  kind: 'zamowienie',
  title: 'Zamówienie na 27.08: 2× Pomidorowa',
  body: '2× Pomidorowa (12.00 zł, cena pracownicza)',
  for_date: '2026-08-27',
  lines: [{ dish_id: 'd1', name: 'Pomidorowa', qty: 2, unit_price: '6.00' }],
  status: 'open',
  accepted_by: null,
  accepted_by_name: null,
  accepted_at: null,
  responses: [],
  created_at: '2026-08-26T10:00:00+00:00',
};

describe('mapowanie', () => {
  it('toFoodMenu czyta liczby z numeric (string) i pomija zepsute pozycje', () => {
    const menu = toFoodMenu(MENU_JSON, '2026-08-27');
    expect(menu.published).toBe(true);
    expect(menu.employeeDiscountPercent).toBe(50);
    expect(menu.items).toEqual([
      {
        dishId: 'd1',
        name: 'Pomidorowa',
        category: 'zupa',
        categoryLabel: 'Zupy',
        price: 12,
        employeePrice: 6,
      },
    ]);
  });

  it('toFoodMenu: menu bez pozycji nie jest opublikowane', () => {
    const menu = toFoodMenu({ date: '2026-08-27', published: true, items: [] }, '2026-08-27');
    expect(menu.published).toBe(false);
    expect(toFoodMenu(null, '2026-08-27')).toEqual({
      date: '2026-08-27',
      published: false,
      employeeDiscountPercent: 0,
      items: [],
    });
  });

  it('toFoodOrder odrzuca nieznany status i brak id', () => {
    expect(toFoodOrder({ ...ORDER_JSON, status: 'dziwny' })).toBeNull();
    expect(toFoodOrder({ ...ORDER_JSON, id: null })).toBeNull();
    const order = toFoodOrder(ORDER_JSON);
    expect(order?.lines).toEqual([{ dishId: 'd1', name: 'Pomidorowa', qty: 2, unitPrice: 6 }]);
    expect(order?.status).toBe('open');
  });
});

describe('operacje', () => {
  it('loadMenu woła food_menu_for_date z datą', async () => {
    const { db, calls } = fakeDb(() => MENU_JSON);
    const result = await loadMenu(db, '2026-08-27');
    expect(calls).toEqual([{ name: 'food_menu_for_date', args: { p_date: '2026-08-27' } }]);
    expect(result.ok && result.value.items.length).toBe(1);
  });

  it('loadDrivers mapuje listę i pomija wiersze bez nazwy', async () => {
    const { db } = fakeDb(() => [
      { id: 'k1', full_name: 'Dawid' },
      { id: 'k2', full_name: null },
    ]);
    const result = await loadDrivers(db);
    expect(result).toEqual({ ok: true, value: [{ id: 'k1', fullName: 'Dawid' }] });
  });

  it('placeOrder przekazuje argumenty RPC w kształcie kontraktu', async () => {
    const { db, calls } = fakeDb(() => ORDER_JSON);
    const result = await placeOrder(db, {
      forDate: '2026-08-27',
      driverId: 'k1',
      lines: [{ dish_id: 'd1', qty: 2 }],
      note: '  bez cebuli ',
      requesterName: 'Ola Nowak',
    });
    expect(calls[0]).toEqual({
      name: 'place_food_order',
      args: {
        p_for_date: '2026-08-27',
        p_driver_id: 'k1',
        p_lines: [{ dish_id: 'd1', qty: 2 }],
        p_note: 'bez cebuli',
        p_requester_name: 'Ola Nowak',
        p_app: 'n2click',
      },
    });
    expect(result.ok && result.value.id).toBe('t1');
  });

  it('placeOrder: pusta notatka i nazwa idą jako null', async () => {
    const { db, calls } = fakeDb(() => ORDER_JSON);
    await placeOrder(db, {
      forDate: '2026-08-27',
      driverId: 'k1',
      lines: [{ dish_id: 'd1', qty: 1 }],
      note: '   ',
      requesterName: '',
    });
    expect(calls[0].args?.p_note).toBeNull();
    expect(calls[0].args?.p_requester_name).toBeNull();
  });

  it('placeOrder oddaje polski komunikat z bazy bez zmian', async () => {
    const { db } = fakeDb(() => null, { code: 'P0001', message: 'Wybierz aktywnego kierowcę.' });
    const result = await placeOrder(db, {
      forDate: '2026-08-27',
      driverId: 'x',
      lines: [{ dish_id: 'd1', qty: 1 }],
      note: '',
      requesterName: '',
    });
    expect(result).toEqual({ ok: false, error: 'Wybierz aktywnego kierowcę.' });
  });

  it('placeOrder bez czytelnej odpowiedzi zgłasza błąd zapasowy', async () => {
    const { db } = fakeDb(() => ({ id: null }));
    const result = await placeOrder(db, {
      forDate: '2026-08-27',
      driverId: 'k1',
      lines: [{ dish_id: 'd1', qty: 1 }],
      note: '',
      requesterName: '',
    });
    expect(result).toEqual({ ok: false, error: FOOD_ERRORS.place });
  });

  it('loadMyOrders sortuje najnowsze u góry i pomija nieczytelne', async () => {
    const { db, calls } = fakeDb(() => [
      { ...ORDER_JSON, id: 'a', created_at: '2026-08-25T10:00:00+00:00' },
      { ...ORDER_JSON, id: 'b', created_at: '2026-08-26T10:00:00+00:00' },
      { id: 'c' },
    ]);
    const result = await loadMyOrders(db);
    expect(calls).toEqual([{ name: 'my_food_orders', args: { p_from: null } }]);
    expect(result.ok && result.value.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('cancelOrder woła cancel_driver_task i zwraca zaktualizowane zamówienie', async () => {
    const { db, calls } = fakeDb(() => ({ ...ORDER_JSON, status: 'cancelled' }));
    const result = await cancelOrder(db, 't1');
    expect(calls).toEqual([{ name: 'cancel_driver_task', args: { p_task_id: 't1' } }]);
    expect(result.ok && result.value.status).toBe('cancelled');
  });

  it('cancelOrderAndReload po sukcesie przeładowuje my_food_orders', async () => {
    const { db, calls } = fakeDb((name) =>
      name === 'cancel_driver_task'
        ? { ...ORDER_JSON, status: 'cancelled' }
        : [{ ...ORDER_JSON, status: 'cancelled' }],
    );
    const { cancel, orders } = await cancelOrderAndReload(db, 't1');
    expect(calls.map((c) => c.name)).toEqual(['cancel_driver_task', 'my_food_orders']);
    expect(cancel.ok).toBe(true);
    expect(orders.ok && orders.value.map((o) => o.status)).toEqual(['cancelled']);
  });

  it('cancelOrderAndReload po błędzie bazy też przeładowuje listę i oddaje tekst błędu', async () => {
    // Baza odmawia (kierowca już przyjął), ale lista MUSI się odświeżyć,
    // żeby użytkownik zobaczył aktualny status zamiast przestarzałego.
    const calls: string[] = [];
    const db: FoodDb = {
      async rpc(name) {
        calls.push(name);
        if (name === 'cancel_driver_task') {
          return {
            data: null,
            error: { code: 'P0001', message: 'Zamówienie zostało już przyjęte przez kierowcę.' },
          };
        }
        return { data: [{ ...ORDER_JSON, status: 'accepted' }], error: null };
      },
    };
    const { cancel, orders } = await cancelOrderAndReload(db, 't1');
    expect(calls).toEqual(['cancel_driver_task', 'my_food_orders']);
    expect(cancel).toEqual({ ok: false, error: 'Zamówienie zostało już przyjęte przez kierowcę.' });
    expect(orders.ok && orders.value.map((o) => o.status)).toEqual(['accepted']);
  });
});
