// Moduł „Content plan" — skórka „Glass" przeniesiona 1:1 z aplikacji źródłowej
// `Content plan/planner` (decyzja operatora 2026-08-04: wygląd i układ mają być
// nieodróżnialne od lokalnego plannera): pozioma tablica tygodni ze
// scroll-snapem, pasek osi czasu, chipy marek, legenda statusów, tryb
// kompaktowy „Rejestr" i wysuwany panel szczegółów publikacji.
//
// DANE zostają w architekturze Huba: slice'y AppStore (`contentPlanBrands` /
// `contentPlanPosts`), zapis wyłącznie przez reduktor (`SAVE_CP_POST` /
// `DELETE_CP_POST`), edycja przez istniejące modale (`?publikacja=`, `?marka=`).
// Czysta logika osi tygodni i grupowań: `contentplan/glassView.ts`.
//
// ŚWIADOMA RÓŻNICA wobec reszty Huba (zapisana też przy stylach `.cp-scene`):
// tablica ma scroller poziomy, a kolumny dni własne scrollery pionowe — to
// rdzeń układu źródłowego, przeniesiony na wyraźne żądanie operatora mimo
// ogólnej zasady „jeden właściciel przewijania na stronę".
//
// Bramka: strona pilnuje się SAMA (wzorzec `AdminPage`) — bramka UX, nie
// granica bezpieczeństwa; realny zakres wymusza RLS schematu `contentplan`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { useContentPlanAccess } from '../contentplan/useContentPlanAccess';
import { monthKeyLabel, monthKeyOf } from '../contentplan/domain';
import {
  CONTENT_PLAN_STATUSES,
} from '../contentplan/domain';
import {
  CONTENT_PLAN_STATUS_META,
  contentPlanPostsByDate,
  contentPlanStatusCounts,
  contentPlanWeekAxis,
  weekIndexOf,
} from '../contentplan/glassView';
import { MONTH_PARAM, resolveMonthParam } from './contentPlanRoute';
import {
  contentPlanBrandOptions,
  contentPlanCardView,
  contentPlanPasteDraft,
} from './contentPlanCalendar';
import { HOME_PATH } from './homeRoute';
import { useStore } from '../store/AppStore';
import { useConfirm } from '../components/ConfirmProvider';
import {
  CONTENT_PLAN_POST_PARAM,
  ContentPlanPostModal,
  contentPlanNewPostParam,
} from '../components/ContentPlanPostModal';
import {
  CONTENT_PLAN_BRAND_PARAM,
  ContentPlanBrandModal,
} from '../components/ContentPlanBrandModal';
import { CpMediaThumb, CpPlatformChip } from '../components/ContentPlanGlass';
import { OverlayLayer, useOverlay } from '../components/useOverlay';
import type { OverlayRect } from '../components/overlayShell';
import { ContentPlanPostDetail } from '../components/ContentPlanPostDetail';
import { ContentPlanRegister } from '../components/ContentPlanRegister';
import { ClipboardPaste, Pencil } from '../components/icons';
import type { ContentPlanBrand, ContentPlanPost, ContentPlanStatus } from '../types';
import { dayMonthLabel, formatShortWithWeekday, todayStr } from '../utils/dates';

const WEEKDAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];

/**
 * Kotwica menu prawego kliku na dniu tablicy — wzorzec `WeekView` (element +
 * punkt kliknięcia), żeby `useOverlay` przeliczał pozycję przy scrollu tablicy
 * i zamknął menu, gdy kolumna wypadnie z DOM (paging tygodni).
 */
interface DayMenuAnchor {
  el: HTMLElement;
  point: { dx: number; dy: number };
}

function dayMenuAnchorRect(anchor: DayMenuAnchor | null | undefined): OverlayRect | null {
  if (!anchor || !anchor.el.isConnected) return null;
  const rect = anchor.el.getBoundingClientRect();
  return { left: rect.left + anchor.point.dx, top: rect.top + anchor.point.dy, width: 0, height: 0 };
}

/**
 * Płynny scroll tablicy do zadanej pozycji. Chromium potrafi PRZERWAĆ płynny
 * `scrollTo` na kontenerze ze `scroll-snap-type: mandatory` i przyciągnąć z
 * powrotem do bieżącego punktu (pomiar 2026-08-04: paging stał w miejscu),
 * więc na czas animacji zdejmujemy snap i przywracamy go po `scrollend`
 * (z zapasowym timeoutem, gdyby zdarzenie nie doleciało).
 */
function smoothBoardScroll(el: HTMLElement, left: number): void {
  el.style.scrollSnapType = 'none';
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    el.style.scrollSnapType = '';
    el.removeEventListener('scrollend', restore);
  };
  el.addEventListener('scrollend', restore);
  window.setTimeout(restore, 900);
  el.scrollTo({ left, behavior: 'smooth' });
}

export function ContentPlanPage() {
  const canView = useContentPlanAccess();
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const today = todayStr();

  // Filtr marki jest wyborem SESJI widoku (parytet ze źródłem: chipy klientów);
  // '' = wszystkie marki. W URL stoją WYŁĄCZNIE miesiąc i otwarte modale.
  const [brandFilter, setBrandFilter] = useState('');
  const [mode, setMode] = useState<'board' | 'register'>('board');
  const [statusFilter, setStatusFilter] = useState<ContentPlanStatus | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [copiedPost, setCopiedPost] = useState<ContentPlanPost | null>(null);
  // Prawy klik na dniu tablicy → menu „dodaj / wklej" (zgłoszenie 2026-08-07:
  // klik w dzień ma pozwalać planować, jak menu slotu kalendarza zadań).
  const [dayMenu, setDayMenu] = useState<{ anchor: DayMenuAnchor; date: string } | null>(null);
  const dayMenuRef = useRef<HTMLDivElement | null>(null);
  const closeDayMenu = useCallback(() => setDayMenu(null), []);
  const dayMenuAnchor = useCallback(() => dayMenuAnchorRect(dayMenu?.anchor), [dayMenu]);
  const dayMenuFocusReturn = useCallback(() => dayMenu?.anchor.el ?? null, [dayMenu]);
  const dayMenuOverlay = useOverlay({
    open: dayMenu !== null,
    onClose: closeDayMenu,
    overlayRef: dayMenuRef,
    getAnchorRect: dayMenuAnchor,
    getFocusReturn: dayMenuFocusReturn,
    menuKeyboard: true,
  });
  const openDayMenu = (date: string, e: React.MouseEvent<HTMLElement>) => {
    // Prawy klik na KARCIE publikacji zostawia natywne menu (karta ma własny
    // lewy klik = podgląd); menu dnia dotyczy wolnej przestrzeni kolumny.
    if ((e.target as HTMLElement).closest('.cp-card')) return;
    e.preventDefault();
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    setDayMenu({
      anchor: { el, point: { dx: e.clientX - rect.left, dy: e.clientY - rect.top } },
      date,
    });
  };

  const openPostId = params.get(CONTENT_PLAN_POST_PARAM);
  const openBrandParam = params.get(CONTENT_PLAN_BRAND_PARAM);

  const setModalParam = useCallback(
    (name: string, value: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(name);
        else next.set(name, value);
        return next;
      });
    },
    [setParams],
  );
  const closePost = useCallback(
    () => setModalParam(CONTENT_PLAN_POST_PARAM, null),
    [setModalParam],
  );
  const closeBrand = useCallback(
    () => setModalParam(CONTENT_PLAN_BRAND_PARAM, null),
    [setModalParam],
  );

  const brands = state.contentPlanBrands;
  const brandOptions = useMemo(() => contentPlanBrandOptions(brands), [brands]);
  const activeBrand: ContentPlanBrand | undefined =
    brands.find((row) => row.id === brandFilter) ?? brands[0];

  // Filtr po marce to prezentacja chipów (oś tygodni potrzebuje WSZYSTKICH
  // miesięcy naraz, więc selektor miesięczny tu nie pasuje).
  const filteredPosts = useMemo(
    () =>
      brandFilter === ''
        ? state.contentPlanPosts
        : state.contentPlanPosts.filter((post) => post.brandId === brandFilter),
    [state.contentPlanPosts, brandFilter],
  );
  const weeks = useMemo(() => contentPlanWeekAxis(filteredPosts, today), [filteredPosts, today]);
  const byDate = useMemo(() => contentPlanPostsByDate(filteredPosts), [filteredPosts]);
  const statusCounts = useMemo(() => contentPlanStatusCounts(filteredPosts), [filteredPosts]);
  const registerPosts = useMemo(
    () =>
      statusFilter === null
        ? filteredPosts
        : filteredPosts.filter((post) => post.status === statusFilter),
    [filteredPosts, statusFilter],
  );

  const todayWeekIdx = weekIndexOf(weeks, today);
  // Start: tydzień z „dziś" albo — przy głębokim linku ?m= — pierwszy tydzień
  // żądanego miesiąca. Późniejsze zmiany osi (filtr marki) korygowane niżej.
  const initialMonth = resolveMonthParam(params.get(MONTH_PARAM), today);
  const [activeIdx, setActiveIdx] = useState(() =>
    initialMonth === monthKeyOf(today)
      ? todayWeekIdx
      : weekIndexOf(weeks, `${initialMonth}-08`),
  );
  const boardRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const clampedIdx = Math.min(weeks.length - 1, Math.max(0, activeIdx));
  const active = weeks[clampedIdx];
  const monthLabelText = active !== undefined ? monthKeyLabel(active.monthKey) : '';

  const gotoWeek = useCallback((index: number, smooth = true) => {
    const el = boardRef.current;
    if (!el) return;
    if (smooth) smoothBoardScroll(el, index * el.clientWidth);
    else el.scrollTo({ left: index * el.clientWidth });
  }, []);

  // Po wejściu i po powrocie z rejestru tablica staje na aktywnym tygodniu.
  useEffect(() => {
    if (mode === 'board') gotoWeek(clampedIdx, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- celowo tylko przy zmianie trybu
  }, [mode, gotoWeek]);

  const onBoardScroll = () => {
    const el = boardRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (index !== activeIdx) setActiveIdx(Math.min(weeks.length - 1, Math.max(0, index)));
  };

  // Scroll nad tablicą (decyzja usera 2026-08-04, druga iteracja): gest pionowy
  // NAJPIERW przewija listę postów kolumny pod kursorem (natywnie); paging
  // tygodni przejmuje go dopiero, gdy kolumna nie ma już czego przewinąć w tym
  // kierunku albo kursor stoi poza listą. Gest poziomy zawsze obsługuje
  // natywny scroll-snap tablicy.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || mode !== 'board') return;
    let acc = 0;
    let cooldown = false;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const columnScroller = (event.target as HTMLElement | null)?.closest?.('.cp-col-posts');
      if (columnScroller instanceof HTMLElement) {
        const canScrollDown =
          event.deltaY > 0 &&
          columnScroller.scrollTop + columnScroller.clientHeight < columnScroller.scrollHeight - 1;
        const canScrollUp = event.deltaY < 0 && columnScroller.scrollTop > 0;
        if (canScrollDown || canScrollUp) return;
      }
      event.preventDefault();
      if (cooldown) return;
      acc += event.deltaY;
      if (Math.abs(acc) < 40) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      cooldown = true;
      window.setTimeout(() => {
        cooldown = false;
      }, 420);
      const index = Math.round(el.scrollLeft / el.clientWidth) + dir;
      smoothBoardScroll(el, Math.min(weeks.length - 1, Math.max(0, index)) * el.clientWidth);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mode, weeks.length]);

  // Aktywna pigułka tygodnia zawsze widoczna na pasku osi.
  useEffect(() => {
    stripRef.current
      ?.querySelector('.cp-week-btn.on')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [clampedIdx, mode]);

  // Pager `?m=` podąża za dominującym miesiącem aktywnego tygodnia (replace —
  // przewijanie osi nie zasypuje historii przeglądarki).
  useEffect(() => {
    if (active === undefined) return;
    if (params.get(MONTH_PARAM) === active.monthKey) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(MONTH_PARAM, active.monthKey);
        return next;
      },
      { replace: true },
    );
  }, [active, params, setParams]);

  if (!canView) return <Navigate to={HOME_PATH} replace />;

  const brandFor = (post: ContentPlanPost) => brands.find((row) => row.id === post.brandId);

  // Parytet ze źródłem: „+" otwiera EDYTOR z pustym szkicem — encja powstaje
  // dopiero przy zapisie, anulowanie niczego nie zostawia w planie.
  const addPost = (date: string) => {
    if (activeBrand === undefined) return;
    setModalParam(CONTENT_PLAN_POST_PARAM, contentPlanNewPostParam(activeBrand.id, date));
  };

  const pastePost = (date: string) => {
    if (copiedPost === null) return;
    const target = brandFor(copiedPost) ?? activeBrand;
    if (target === undefined) return;
    dispatch({
      type: 'SAVE_CP_POST',
      postId: null,
      draft: contentPlanPasteDraft(copiedPost, target, date),
      historyLabel: 'Skopiowano publikację do nowego dnia',
    });
  };

  const deletePost = async (post: ContentPlanPost) => {
    const confirmed = await confirm({
      title: `Usunąć publikację „${post.title}”?`,
      consequences: 'To usunie treści kanałów, komentarze i historię tej publikacji.',
      confirmLabel: 'Usuń publikację',
      tone: 'danger',
    });
    if (!confirmed) return;
    dispatch({ type: 'DELETE_CP_POST', postId: post.id });
    if (openPostId === post.id) closePost();
    if (selectedPostId === post.id) setSelectedPostId(null);
    if (copiedPost?.id === post.id) setCopiedPost(null);
  };

  const selectedPost =
    selectedPostId !== null
      ? state.contentPlanPosts.find((post) => post.id === selectedPostId)
      : undefined;
  const selectedBrand = selectedPost !== undefined ? brandFor(selectedPost) : undefined;

  const renderCard = (post: ContentPlanPost) => {
    const brand = brandFor(post);
    if (brand === undefined) return null;
    const view = contentPlanCardView(brand, post);
    const statusMeta = CONTENT_PLAN_STATUS_META[post.status];
    const withMedia = post.channels.find((channel) => channel.media !== undefined);
    return (
      <button
        key={post.id}
        type="button"
        className="cp-card"
        style={{ '--glow': statusMeta.color } as React.CSSProperties}
        onClick={() => setSelectedPostId(post.id)}
      >
        <CpMediaThumb
          media={withMedia?.media}
          className="cp-card-media"
          aspectRatio={view.aspectRatio}
          adaptive
        />
        <span className="cp-card-body">
          <span className="cp-card-top">
            <span className="cp-card-topic">{post.topic === '' ? 'publikacja' : post.topic}</span>
            <span className="cp-card-status" style={{ color: statusMeta.color }}>
              {post.status}
            </span>
          </span>
          <span className="cp-card-title">{post.title}</span>
          <span className="cp-card-platforms">
            {brandFilter === '' && (
              <span
                className="cp-card-brand"
                style={{ background: brand.accent || 'var(--n2-lavender)' }}
                title={brand.name}
              >
                {brand.name.slice(0, 2).toLocaleUpperCase('pl-PL')}
              </span>
            )}
            {view.platforms.map((platform) => (
              <CpPlatformChip key={platform.id} platform={platform} size={17} />
            ))}
            <span className="cp-card-type">{post.format === '' ? '' : post.format}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <section className="page cp-page">
      <div className="cp-scene">
        <div className="cp-aurora" aria-hidden />

        <header className="cp-head">
          <div className="cp-headline">
            <h1 className="cp-month">{monthLabelText}</h1>
            <div className="cp-legend">
              {CONTENT_PLAN_STATUSES.filter((status) => (statusCounts.get(status) ?? 0) > 0).map(
                (status) => (
                  <span key={status} className="cp-legend-item">
                    <i
                      style={{
                        background: CONTENT_PLAN_STATUS_META[status].color,
                        boxShadow: `0 0 8px ${CONTENT_PLAN_STATUS_META[status].color}`,
                      }}
                      aria-hidden
                    />
                    {status}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="cp-tools">
            <div className="cp-brand-chips">
              <button
                type="button"
                className={`cp-chip${brandFilter === '' ? ' on' : ''}`}
                onClick={() => setBrandFilter('')}
              >
                Wszystkie marki
              </button>
              {brandOptions.map((option) => {
                const brand = brands.find((row) => row.id === option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`cp-chip${brandFilter === option.id ? ' on' : ''}`}
                    onClick={() => setBrandFilter(option.id)}
                  >
                    <span
                      className="cp-chip-logo"
                      style={{ background: brand?.accent || 'var(--n2-lavender)' }}
                      aria-hidden
                    >
                      {option.name.slice(0, 2).toLocaleUpperCase('pl-PL')}
                    </span>
                    {option.name}
                  </button>
                );
              })}
              {brandFilter !== '' && (
                <button
                  type="button"
                  className="cp-chip cp-chip-edit"
                  aria-haspopup="dialog"
                  onClick={() => setModalParam(CONTENT_PLAN_BRAND_PARAM, brandFilter)}
                >
                  <Pencil size={12} aria-hidden /> Edytuj markę
                </button>
              )}
              <button
                type="button"
                className="cp-chip cp-chip-add"
                aria-haspopup="dialog"
                onClick={() => setModalParam(CONTENT_PLAN_BRAND_PARAM, 'new')}
              >
                + Nowa marka
              </button>
            </div>
            <div className="cp-tools-right">
              <div className="cp-mode" role="group" aria-label="Tryb widoku">
                <button
                  type="button"
                  aria-pressed={mode === 'board'}
                  className={`cp-mode-btn${mode === 'board' ? ' on' : ''}`}
                  onClick={() => setMode('board')}
                >
                  ▦ Tablica
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'register'}
                  className={`cp-mode-btn${mode === 'register' ? ' on' : ''}`}
                  onClick={() => setMode('register')}
                >
                  ☰ Rejestr
                </button>
              </div>
              <button
                type="button"
                className="cp-newpost"
                disabled={activeBrand === undefined}
                onClick={() => addPost(today)}
              >
                + Nowa publikacja
              </button>
            </div>
          </div>
        </header>

        {brands.length === 0 ? (
          <div className="cp-scene-empty">
            <p className="empty-title">Brak marek w module.</p>
            <p className="empty-hint">
              Plan publikacji układa się dla konkretnej marki. Dodaj pierwszą markę razem z jej
              platformami, tematami i typami publikacji.
            </p>
            <button
              type="button"
              className="btn primary"
              aria-haspopup="dialog"
              onClick={() => setModalParam(CONTENT_PLAN_BRAND_PARAM, 'new')}
            >
              Dodaj markę
            </button>
          </div>
        ) : mode === 'board' ? (
          <>
            <nav className="cp-strip" aria-label="Oś czasu w tygodniach">
              <button
                type="button"
                className="cp-strip-nav"
                onClick={() => gotoWeek(Math.max(0, clampedIdx - 1))}
                aria-label="Poprzedni tydzień"
              >
                ‹
              </button>
              <div className="cp-strip-scroll" ref={stripRef}>
                {weeks.map((week, index) => {
                  const count = week.days.reduce(
                    (sum, day) => sum + (byDate.get(day.date)?.length ?? 0),
                    0,
                  );
                  const newMonth = index === 0 || week.monthKey !== weeks[index - 1].monthKey;
                  return (
                    <span key={week.start} className="cp-strip-cell">
                      {newMonth && (
                        <span className="cp-strip-month">
                          {monthKeyLabel(week.monthKey).slice(0, 3)}
                        </span>
                      )}
                      <button
                        type="button"
                        className={`cp-week-btn${index === clampedIdx ? ' on' : ''}${index === todayWeekIdx ? ' now' : ''}`}
                        onClick={() => gotoWeek(index)}
                      >
                        <span className="cp-week-range">{week.rangeLabel}</span>
                        {count > 0 && <span className="cp-week-count">{count}</span>}
                      </button>
                    </span>
                  );
                })}
              </div>
              <button
                type="button"
                className="cp-strip-nav"
                onClick={() => gotoWeek(Math.min(weeks.length - 1, clampedIdx + 1))}
                aria-label="Następny tydzień"
              >
                ›
              </button>
              <button type="button" className="cp-strip-today" onClick={() => gotoWeek(todayWeekIdx)}>
                Dziś
              </button>
            </nav>

            <div className="cp-board" ref={boardRef} onScroll={onBoardScroll}>
              {weeks.map((week) => (
                <section key={week.start} className="cp-week" aria-label={`Tydzień ${week.rangeLabel}`}>
                  {week.days.map((day, dayIndex) => {
                    const dayPosts = byDate.get(day.date) ?? [];
                    const isToday = day.date === today;
                    const isPast = day.date < today;
                    return (
                      <section
                        key={day.date}
                        className={`cp-col${isToday ? ' today' : ''}${isPast ? ' past' : ''}`}
                        onContextMenu={(e) => openDayMenu(day.date, e)}
                      >
                        <div className="cp-col-head">
                          <span className="cp-col-dow">{WEEKDAYS[dayIndex]}</span>
                          <span className="cp-col-day">{day.day}</span>
                          {isToday && <span className="cp-col-today">dziś</span>}
                          <button
                            type="button"
                            className="cp-col-add"
                            aria-label={`Dodaj publikację: ${dayMonthLabel(day.date)}`}
                            onClick={() => addPost(day.date)}
                          >
                            +
                          </button>
                        </div>
                        <div className="cp-col-posts">
                          {dayPosts.length === 0 && copiedPost === null && (
                            <div className="cp-col-empty" aria-hidden>
                              ·
                            </div>
                          )}
                          {dayPosts.map((post) => renderCard(post))}
                          {copiedPost !== null && (
                            <button
                              type="button"
                              className="cp-paste"
                              onClick={() => pastePost(day.date)}
                            >
                              <ClipboardPaste size={13} aria-hidden /> Wklej „{copiedPost.title}”
                            </button>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </section>
              ))}
            </div>
          </>
        ) : (
          <div className="cp-register">
            <div className="cp-flags">
              <button
                type="button"
                className={`cp-flag${statusFilter === null ? ' on' : ''}`}
                onClick={() => setStatusFilter(null)}
              >
                wszystkie <b>{filteredPosts.length}</b>
              </button>
              {CONTENT_PLAN_STATUSES.map((status) => {
                const count = statusCounts.get(status) ?? 0;
                if (count === 0) return null;
                return (
                  <button
                    key={status}
                    type="button"
                    className={`cp-flag${statusFilter === status ? ' on' : ''}`}
                    style={{ '--sc': CONTENT_PLAN_STATUS_META[status].color } as React.CSSProperties}
                    onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                  >
                    {status.toLocaleLowerCase('pl-PL')} <b>{count}</b>
                  </button>
                );
              })}
            </div>
            <ContentPlanRegister
              brands={brands}
              posts={registerPosts}
              showBrand={brandFilter === ''}
              onEdit={(post) => setModalParam(CONTENT_PLAN_POST_PARAM, post.id)}
            />
          </div>
        )}
      </div>

      {selectedPost !== undefined && selectedBrand !== undefined && openPostId === null && (
        <ContentPlanPostDetail
          brand={selectedBrand}
          post={selectedPost}
          copied={copiedPost?.id === selectedPost.id}
          onClose={() => setSelectedPostId(null)}
          onEdit={() => setModalParam(CONTENT_PLAN_POST_PARAM, selectedPost.id)}
          onCopy={() => setCopiedPost(selectedPost)}
          onDelete={() => {
            void deletePost(selectedPost);
          }}
        />
      )}

      {/* Menu prawego kliku na dniu tablicy — ta sama powłoka `useOverlay` i
          klasy `.context-menu`, co menu slotu kalendarza zadań. */}
      <OverlayLayer>
        <AnimatePresence>
          {dayMenu && (
            <m.div
              className="context-menu"
              style={{ ...dayMenuOverlay.style, transformOrigin: 'top left' }}
              role="menu"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div ref={dayMenuRef}>
                <div className="context-menu-title">{formatShortWithWeekday(dayMenu.date)}</div>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  disabled={activeBrand === undefined}
                  onClick={() => {
                    const date = dayMenu.date;
                    setDayMenu(null);
                    addPost(date);
                  }}
                >
                  + Nowa publikacja
                </button>
                {copiedPost !== null && (
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={() => {
                      const date = dayMenu.date;
                      setDayMenu(null);
                      pastePost(date);
                    }}
                  >
                    <ClipboardPaste size={13} aria-hidden /> Wklej „{copiedPost.title}”
                  </button>
                )}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </OverlayLayer>

      {/* Modale modułu: montowane W STRONIE (samo-guard strony reużyty), każdy w
          osobnym `AnimatePresence`. Nieznane id obsługuje sam modal. */}
      <AnimatePresence>
        {openPostId !== null && (
          <ContentPlanPostModal key={`cp-post-${openPostId}`} postId={openPostId} onClose={closePost} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {openBrandParam !== null && (
          <ContentPlanBrandModal
            key={`cp-brand-${openBrandParam}`}
            brandParam={openBrandParam}
            onClose={closeBrand}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
