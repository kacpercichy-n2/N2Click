// Jedzenie: pracownicy zamawiają jutrzejszy posiłek z cateringu Błogość
// w cenie pracowniczej. Zamówienie trafia do wybranego kierowcy jako zadanie
// w jego aplikacji (BłogoSELL), które przyjmuje albo odrzuca.
//
// Backend to schemat `blogoapp` TEGO SAMEGO projektu Supabase, dostępny
// WYŁĄCZNIE przez RPC (`src/food/foodData.ts`). Strona jest cienkim
// okablowaniem: stan koszyka + wywołania adaptera; cały czysty model (data
// domyślna, kwoty, statusy, koszyk) siedzi w `src/food/foodModel.ts`.
//
// Widoczna dla KAŻDEJ roli. W trybie lokalnym (brak sesji chmury) pokazuje
// wyłącznie pusty stan, bo bramka nie ma lokalnego odpowiednika.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { m } from 'motion/react';
import { useStore } from '../store/AppStore';
import { currentUser as currentUserSel } from '../store/selectors';
import { useAuth } from '../auth/SessionProvider';
import { getSupabaseClient } from '../supabase/client';
import { useConfirm } from '../components/ConfirmProvider';
import { IconButton } from '../components/IconButton';
import { ChevronLeft, ChevronRight, Minus, Plus } from '../components/icons';
import {
  addDaysStr,
  formatShortWithWeekday,
  formatTimestamp,
  isValidDateStr,
  todayStr,
} from '../utils/dates';
import {
  cancelOrderAndReload,
  createSupabaseFoodDb,
  loadDrivers,
  loadMenu,
  loadMyOrders,
  placeOrder,
  type FoodDb,
} from '../food/foodData';
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
  orderStatusLabel,
  orderStatusTone,
  orderTotal,
  requesterDisplayName,
  upsertOrder,
  type FoodDriver,
  type FoodMenu,
  type FoodOrder,
} from '../food/foodModel';

type MenuState =
  | { status: 'loading' }
  | { status: 'ready'; menu: FoodMenu }
  | { status: 'error'; error: string };

type OrdersState =
  | { status: 'loading' }
  | { status: 'ready'; orders: FoodOrder[] }
  | { status: 'error'; error: string };

export function FoodPage() {
  const { state } = useStore();
  const auth = useAuth();
  const confirm = useConfirm();

  // Bramka działa tylko na realnej sesji chmury (RPC wymagają `auth.uid()`).
  const cloud =
    auth.mode === 'supabase' && auth.state.status === 'signedIn' && auth.state.session !== null;
  const db: FoodDb | null = useMemo(
    () => (cloud ? createSupabaseFoodDb(getSupabaseClient()) : null),
    [cloud],
  );

  const me = currentUserSel(state);
  const requesterName = requesterDisplayName(me?.name, auth.state.session?.user?.email);

  const [date, setDate] = useState<string>(() => defaultOrderDate());
  const [menuState, setMenuState] = useState<MenuState>({ status: 'loading' });
  const [drivers, setDrivers] = useState<FoodDriver[]>([]);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [driverId, setDriverId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);
  const [ordersState, setOrdersState] = useState<OrdersState>({ status: 'loading' });
  const [ordersRefreshing, setOrdersRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Licznik żądań listy: spóźniona odpowiedź starszego odświeżenia jest ignorowana.
  const ordersRequestRef = useRef(0);

  const today = todayStr();
  const orderable = isOrderableDate(date);

  // „Moje zamówienia": ładowane na starcie, po złożeniu i anulowaniu
  // zamówienia oraz ręcznie przyciskiem „Odśwież". Lista nie jest kasowana
  // podczas odświeżania, żeby widok nie mrugał.
  const reloadOrders = useCallback(async () => {
    if (!db) return;
    const requestId = ++ordersRequestRef.current;
    setOrdersRefreshing(true);
    const result = await loadMyOrders(db);
    if (requestId !== ordersRequestRef.current) return;
    setOrdersRefreshing(false);
    setOrdersState(
      result.ok ? { status: 'ready', orders: result.value } : { status: 'error', error: result.error },
    );
  }, [db]);

  // Menu dnia: zmiana daty czyści koszyk i ładuje od nowa; spóźniona
  // odpowiedź poprzedniej daty jest ignorowana.
  useEffect(() => {
    if (!db) return;
    let alive = true;
    setMenuState({ status: 'loading' });
    setQuantities({});
    setSubmitError(null);
    setSubmitOk(null);
    void loadMenu(db, date).then((result) => {
      if (!alive) return;
      setMenuState(
        result.ok ? { status: 'ready', menu: result.value } : { status: 'error', error: result.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [db, date]);

  // Kierowcy: raz na sesję chmury. Moje zamówienia: pierwsze wczytanie tutaj,
  // kolejne przez `reloadOrders`.
  useEffect(() => {
    if (!db) return;
    let alive = true;
    void loadDrivers(db).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setDrivers(result.value);
        setDriversError(null);
      } else {
        setDriversError(result.error);
      }
    });
    void reloadOrders();
    return () => {
      alive = false;
      // Unieważnia odpowiedź w locie po odmontowaniu / zmianie sesji.
      ordersRequestRef.current += 1;
    };
  }, [db, reloadOrders]);

  const menu = menuState.status === 'ready' ? menuState.menu : null;
  const groups = useMemo(() => (menu ? groupMenuItems(menu.items) : []), [menu]);
  const lines = useMemo(
    () => (menu ? buildOrderLines(quantities, menu.items) : []),
    [menu, quantities],
  );
  const total = menu ? cartTotal(quantities, menu.items) : 0;
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const canSubmit = canPlaceOrder(lines, driverId) && orderable && !submitting;

  const setQty = useCallback((dishId: string, next: number) => {
    setQuantities((prev) => ({ ...prev, [dishId]: clampQty(next) }));
    setSubmitOk(null);
  }, []);

  const changeDate = (next: string) => {
    if (!isValidDateStr(next)) return;
    setDate(next);
  };

  const submit = async () => {
    if (!db || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitOk(null);
    const result = await placeOrder(db, {
      forDate: date,
      driverId,
      lines,
      note,
      requesterName,
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    setQuantities({});
    setNote('');
    setSubmitOk('Zamówienie wysłane do kierowcy.');
    // Nowe zamówienie od razu na listę, a w tle świeży stan z bazy.
    setOrdersState((prev) => ({
      status: 'ready',
      orders: upsertOrder(prev.status === 'ready' ? prev.orders : [], result.value),
    }));
    void reloadOrders();
  };

  const cancel = async (order: FoodOrder) => {
    if (!db) return;
    const ok = await confirm({
      title: 'Anulować zamówienie?',
      description: `${order.title}. Kierowca dostanie informację o anulowaniu.`,
      confirmLabel: 'Anuluj zamówienie',
      tone: 'danger',
    });
    if (!ok) return;
    setCancellingId(order.id);
    setCancelError(null);
    // Lista wraca z bazy także po odmowie (np. kierowca zdążył przyjąć),
    // a tekst błędu z bazy trafia do użytkownika bez zmian.
    const requestId = ++ordersRequestRef.current;
    const { cancel: result, orders } = await cancelOrderAndReload(db, order.id);
    setCancellingId(null);
    if (!result.ok) setCancelError(result.error);
    if (requestId !== ordersRequestRef.current) return;
    setOrdersState(
      orders.ok ? { status: 'ready', orders: orders.value } : { status: 'error', error: orders.error },
    );
  };

  if (!cloud) {
    return (
      <section className="page">
        <div className="page-head">
          <h1>Jedzenie</h1>
        </div>
        <div className="empty-state">
          <div>
            <p className="empty-title">Zamówienia działają tylko po zalogowaniu do chmury</p>
            <p className="empty-hint">
              Menu i kierowcy przychodzą z aplikacji Błogość, więc w trybie lokalnym nie ma czego
              zamawiać.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>Jedzenie</h1>
        <div className="food-date" data-testid="food-date">
          <IconButton
            label="Poprzedni dzień"
            icon={<ChevronLeft size={18} />}
            onClick={() => changeDate(addDaysStr(date, -1))}
            disabled={date <= today}
            disabledReason="Zamówienie można złożyć najwcześniej na dziś."
          />
          <input
            type="date"
            value={date}
            min={today}
            aria-label="Dzień zamówienia"
            onChange={(e) => changeDate(e.target.value)}
          />
          <IconButton
            label="Następny dzień"
            icon={<ChevronRight size={18} />}
            onClick={() => changeDate(addDaysStr(date, 1))}
          />
          <span className="food-date-label">{formatShortWithWeekday(date)}</span>
        </div>
      </div>

      <div className="food-layout">
        <div>
          <div className="editor-section">
            <h2>Menu dnia</h2>
            {menuState.status === 'loading' && <p className="field-hint">Wczytywanie menu…</p>}
            {menuState.status === 'error' && <p className="field-error">{menuState.error}</p>}
            {menu && !menu.published && (
              <div className="empty-state">
                <div>
                  <p className="empty-title">Menu na ten dzień nie jest jeszcze opublikowane</p>
                  <p className="empty-hint">Sprawdź później albo wybierz inny dzień.</p>
                </div>
              </div>
            )}
            {menu && menu.published && (
              <>
                <p className="field-hint">
                  Ceny pracownicze po rabacie {menu.employeeDiscountPercent}%. Napoje są poza
                  rabatem i nie ma ich w tej liście.
                </p>
                {groups.map((group) => (
                  <div className="food-group" key={group.category}>
                    <h3 className="food-group-title">{group.label}</h3>
                    <ul className="food-menu-list">
                      {group.items.map((item) => {
                        const qty = quantities[item.dishId] ?? 0;
                        return (
                          <li
                            className="food-menu-row"
                            key={item.dishId}
                            data-selected={qty > 0 ? true : undefined}
                          >
                            <span className="food-menu-name">{item.name}</span>
                            <span className="food-menu-prices">
                              <s className="food-price-full">{formatPln(item.price)}</s>
                              <strong className="food-price">{formatPln(item.employeePrice)}</strong>
                            </span>
                            <span
                              className="food-stepper"
                              role="group"
                              aria-label={`Sztuki: ${item.name}`}
                            >
                              <button
                                type="button"
                                className="food-step"
                                aria-label={`Mniej: ${item.name}`}
                                disabled={qty <= 0}
                                onClick={() => setQty(item.dishId, qty - 1)}
                              >
                                <Minus size={16} />
                              </button>
                              <span className="food-qty" aria-live="polite">
                                {qty}
                              </span>
                              <button
                                type="button"
                                className="food-step"
                                aria-label={`Więcej: ${item.name}`}
                                disabled={qty >= FOOD_MAX_QTY}
                                onClick={() => setQty(item.dishId, qty + 1)}
                              >
                                <Plus size={16} />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div>
          <div className="editor-section">
            <h2>Zamówienie</h2>
            <div className="field">
              <label htmlFor="food-driver">Kierowca</label>
              <select
                id="food-driver"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">Wybierz kierowcę</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.fullName}
                  </option>
                ))}
              </select>
              {driversError && <p className="field-error">{driversError}</p>}
              {!driversError && drivers.length === 0 && (
                <p className="field-hint">Brak aktywnych kierowców.</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="food-note">Uwagi dla kierowcy</label>
              <textarea
                id="food-note"
                rows={3}
                value={note}
                placeholder="np. odbiór po 12:00, bez cebuli"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="food-summary">
              <span className="muted">
                {itemCount === 0 ? 'Koszyk jest pusty' : `Sztuk: ${itemCount}`}
              </span>
              <strong>{formatPln(total)}</strong>
            </div>
            <p className="field-hint">
              Zamawia: {requesterName || 'nieznany'} · na {formatShortWithWeekday(date)}
            </p>
            {!orderable && (
              <p className="field-hint" data-testid="food-weekend-note">
                Zamówienia tylko na dni robocze.
              </p>
            )}
            {submitError && <p className="field-error">{submitError}</p>}
            {submitOk && <p className="field-hint">{submitOk}</p>}
            <button
              type="button"
              className="btn primary"
              disabled={!canSubmit}
              aria-busy={submitting || undefined}
              onClick={() => void submit()}
            >
              {submitting ? 'Wysyłanie…' : 'Zamów'}
            </button>
          </div>

          <div className="editor-section">
            <div className="section-head">
              <h2>Moje zamówienia</h2>
              <div className="section-head-actions">
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={ordersRefreshing}
                  aria-busy={ordersRefreshing || undefined}
                  onClick={() => void reloadOrders()}
                >
                  {ordersRefreshing ? 'Odświeżanie…' : 'Odśwież'}
                </button>
              </div>
            </div>
            {ordersState.status === 'loading' && (
              <p className="field-hint">Wczytywanie zamówień…</p>
            )}
            {ordersState.status === 'error' && (
              <p className="field-error">{ordersState.error}</p>
            )}
            {cancelError && <p className="field-error">{cancelError}</p>}
            {ordersState.status === 'ready' && ordersState.orders.length === 0 && (
              <p className="field-hint">Nie masz jeszcze zamówień.</p>
            )}
            {ordersState.status === 'ready' && ordersState.orders.length > 0 && (
              <ul className="food-order-list">
                {ordersState.orders.map((order) => {
                  const lastResponse = order.responses[order.responses.length - 1];
                  return (
                    <m.li
                      key={order.id}
                      className="food-order"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                      <div className="food-order-head">
                        <strong>{formatShortWithWeekday(order.forDate)}</strong>
                        <span
                          className="food-status"
                          data-tone={orderStatusTone(order.status)}
                        >
                          {orderStatusLabel(order)}
                        </span>
                      </div>
                      <ul className="food-order-lines">
                        {order.lines.map((line) => (
                          <li key={`${order.id}-${line.dishId}`}>
                            {line.qty}× {line.name} · {formatPln(line.qty * line.unitPrice)}
                          </li>
                        ))}
                      </ul>
                      {order.status === 'rejected' && lastResponse?.note && (
                        <p className="field-hint">Powód: {lastResponse.note}</p>
                      )}
                      <div className="food-order-meta">
                        <span>
                          Razem {formatPln(orderTotal(order.lines))} · złożone{' '}
                          {formatTimestamp(order.createdAt)}
                        </span>
                        {order.status === 'open' && (
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={cancellingId === order.id}
                            aria-busy={cancellingId === order.id || undefined}
                            onClick={() => void cancel(order)}
                          >
                            Anuluj
                          </button>
                        )}
                      </div>
                    </m.li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
