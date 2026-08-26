// Testy czystego modelu strony „Jedzenie": domyślna data zamówienia, kwoty,
// etykiety statusów i pomocnicy koszyka. Bez Reacta, bez SDK.
import { describe, expect, it } from 'vitest';
import {
  FOOD_MAX_QTY,
  buildOrderLines,
  canPlaceOrder,
  cartTotal,
  clampQty,
  defaultOrderDate,
  formatPln,
  groupMenuItems,
  isOrderableDate,
  lineTotal,
  orderStatusLabel,
  orderStatusTone,
  orderTotal,
  requesterDisplayName,
  sortOrdersNewestFirst,
  upsertOrder,
  type FoodMenuItem,
  type FoodOrder,
} from './foodModel';

const ZUPA: FoodMenuItem = {
  dishId: 'd-zupa',
  name: 'Pomidorowa',
  category: 'zupa',
  categoryLabel: 'Zupy',
  price: 12,
  employeePrice: 6,
};
const DANIE: FoodMenuItem = {
  dishId: 'd-danie',
  name: 'Schabowy',
  category: 'danie',
  categoryLabel: 'Dania główne',
  price: 25.5,
  employeePrice: 12.75,
};
const DANIE2: FoodMenuItem = {
  dishId: 'd-danie2',
  name: 'Pierogi',
  category: 'danie',
  categoryLabel: 'Dania główne',
  price: 20,
  employeePrice: 10,
};

function order(overrides: Partial<FoodOrder>): FoodOrder {
  return {
    id: 'o1',
    title: 'Zamówienie',
    body: '',
    forDate: '2026-08-27',
    lines: [],
    status: 'open',
    acceptedByName: null,
    acceptedAt: null,
    responses: [],
    createdAt: '2026-08-26T10:00:00+00:00',
    ...overrides,
  };
}

describe('defaultOrderDate', () => {
  it('wybiera następny dzień kalendarzowy', () => {
    // Środa 2026-08-26 → czwartek.
    expect(defaultOrderDate(new Date(2026, 7, 26, 15, 30))).toBe('2026-08-27');
  });

  it('z piątku przeskakuje weekend na poniedziałek', () => {
    // Piątek 2026-08-28 → jutro sobota → poniedziałek 2026-08-31.
    expect(defaultOrderDate(new Date(2026, 7, 28, 9))).toBe('2026-08-31');
  });

  it('z soboty przeskakuje niedzielę na poniedziałek', () => {
    // Sobota 2026-08-29 → jutro niedziela → poniedziałek 2026-08-31.
    expect(defaultOrderDate(new Date(2026, 7, 29, 9))).toBe('2026-08-31');
  });

  it('z niedzieli daje poniedziałek', () => {
    // Niedziela 2026-08-30 → jutro poniedziałek 2026-08-31.
    expect(defaultOrderDate(new Date(2026, 7, 30, 9))).toBe('2026-08-31');
  });
});

describe('isOrderableDate', () => {
  it('odrzuca sobotę i niedzielę, przyjmuje dni robocze', () => {
    expect(isOrderableDate('2026-08-28')).toBe(true); // piątek
    expect(isOrderableDate('2026-08-29')).toBe(false); // sobota
    expect(isOrderableDate('2026-08-30')).toBe(false); // niedziela
    expect(isOrderableDate('2026-08-31')).toBe(true); // poniedziałek
  });
});

describe('kwoty', () => {
  it('formatuje PLN z przecinkiem i dwoma miejscami', () => {
    expect(formatPln(12.5)).toBe('12,50 zł');
    expect(formatPln(0)).toBe('0,00 zł');
    expect(formatPln(1234)).toBe('1234,00 zł');
    expect(formatPln(Number.NaN)).toBe('0,00 zł');
  });

  it('liczy linię i sumę w groszach (bez błędu zmiennoprzecinkowego)', () => {
    expect(lineTotal(3, 0.1)).toBe(0.3);
    expect(orderTotal([{ qty: 3, unitPrice: 0.1 }, { qty: 2, unitPrice: 12.75 }])).toBe(25.8);
    expect(orderTotal([])).toBe(0);
  });

  it('cartTotal używa ceny pracowniczej i pomija zera', () => {
    expect(cartTotal({ 'd-zupa': 2, 'd-danie': 1, 'd-danie2': 0 }, [ZUPA, DANIE, DANIE2])).toBe(
      24.75,
    );
  });
});

describe('statusy', () => {
  it('mapuje status na polską etykietę', () => {
    expect(orderStatusLabel(order({ status: 'open' }))).toBe('Czeka na kierowcę');
    expect(orderStatusLabel(order({ status: 'accepted', acceptedByName: 'Dawid' }))).toBe(
      'Przyjął: Dawid',
    );
    expect(orderStatusLabel(order({ status: 'accepted', acceptedByName: null }))).toBe('Przyjęte');
    expect(orderStatusLabel(order({ status: 'rejected' }))).toBe('Odrzucone');
    expect(orderStatusLabel(order({ status: 'cancelled' }))).toBe('Anulowane');
    expect(orderStatusLabel(order({ status: 'done' }))).toBe('Zrealizowane');
  });

  it('ton pigułki', () => {
    expect(orderStatusTone('open')).toBe('pending');
    expect(orderStatusTone('accepted')).toBe('success');
    expect(orderStatusTone('done')).toBe('success');
    expect(orderStatusTone('rejected')).toBe('danger');
    expect(orderStatusTone('cancelled')).toBe('muted');
  });
});

describe('koszyk', () => {
  it('grupuje pozycje po kategorii w kolejności z bazy', () => {
    const groups = groupMenuItems([ZUPA, DANIE, DANIE2]);
    expect(groups.map((g) => g.label)).toEqual(['Zupy', 'Dania główne']);
    expect(groups[1].items.map((i) => i.name)).toEqual(['Schabowy', 'Pierogi']);
  });

  it('clampQty trzyma się 0..FOOD_MAX_QTY i odcina ułamki', () => {
    expect(clampQty(-1)).toBe(0);
    expect(clampQty(2.9)).toBe(2);
    expect(clampQty(99)).toBe(FOOD_MAX_QTY);
    expect(clampQty(Number.NaN)).toBe(0);
  });

  it('buildOrderLines pomija zera i pozycje spoza menu', () => {
    expect(buildOrderLines({ 'd-zupa': 1, 'd-danie': 0, obce: 5 }, [ZUPA, DANIE])).toEqual([
      { dish_id: 'd-zupa', qty: 1 },
    ]);
  });

  it('canPlaceOrder wymaga linii i kierowcy', () => {
    expect(canPlaceOrder([], 'k1')).toBe(false);
    expect(canPlaceOrder([{ dish_id: 'd-zupa', qty: 1 }], '')).toBe(false);
    expect(canPlaceOrder([{ dish_id: 'd-zupa', qty: 1 }], 'k1')).toBe(true);
  });
});

describe('lista zamówień', () => {
  it('sortuje najnowsze u góry', () => {
    const a = order({ id: 'a', createdAt: '2026-08-26T08:00:00+00:00' });
    const b = order({ id: 'b', createdAt: '2026-08-26T09:00:00+00:00' });
    expect(sortOrdersNewestFirst([a, b]).map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('upsertOrder podmienia po id i zachowuje porządek', () => {
    const a = order({ id: 'a', createdAt: '2026-08-26T08:00:00+00:00' });
    const b = order({ id: 'b', createdAt: '2026-08-26T09:00:00+00:00' });
    const cancelled = { ...a, status: 'cancelled' as const };
    const next = upsertOrder([b, a], cancelled);
    expect(next.map((o) => o.id)).toEqual(['b', 'a']);
    expect(next[1].status).toBe('cancelled');
  });
});

describe('requesterDisplayName', () => {
  it('woli imię osoby, w zapasie e-mail', () => {
    expect(requesterDisplayName('Ola Nowak', 'ola@n2.pl')).toBe('Ola Nowak');
    expect(requesterDisplayName('  ', 'ola@n2.pl')).toBe('ola@n2.pl');
    expect(requesterDisplayName(undefined, null)).toBe('');
  });
});
