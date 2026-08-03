// Moduł „Content plan" — kalendarz miesiąca publikacji: wybór marki, przegląd
// miesiąca (liczniki + rozkład kanałów) i siatka dni z kartami publikacji.
// Edytor publikacji i zarządzanie markami wchodzą kolejną fazą; karta tylko
// ZAZNACZA publikację (podświetlenie), nigdy nie otwiera edycji.
//
// Cała logika „dane → co widać" siedzi w czystym `contentPlanCalendar.ts`
// (grupowanie po dniach, liczniki, model karty, ładunki kopiuj/wklej), a stan
// pagera w `contentPlanRoute.ts` — tutaj zostaje sam render i wysyłka akcji.
// Jedyną granicą zapisu jest reduktor (`SAVE_CP_POST` / `DELETE_CP_POST`).
//
// Bramka: strona pilnuje się SAMA (wzorzec `AdminPage`/`TeamPage`), więc wejście
// z paska adresu przez użytkownika bez roli kończy się przekierowaniem na Panel,
// nawet gdyby pozycja menu wyciekła. To bramka UX, nie granica bezpieczeństwa —
// realny zakres wymusza serwer (RLS schematu `contentplan`).
import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { m, useReducedMotion } from 'motion/react';
import { useContentPlanAccess } from '../contentplan/useContentPlanAccess';
import { monthKeyDays } from '../contentplan/domain';
import { MONTH_PARAM, monthPagerFromParam, resolveMonthParam } from './contentPlanRoute';
import {
  contentPlanBrandOptions,
  contentPlanCardView,
  contentPlanDaysWithPosts,
  contentPlanDecisionMetric,
  contentPlanEmptyDraft,
  contentPlanPasteDraft,
  contentPlanPlatformBreakdown,
  resolveContentPlanBrandId,
} from './contentPlanCalendar';
import { HOME_PATH } from './homeRoute';
import { useStore } from '../store/AppStore';
import { contentPlanMonthStats, contentPlanPostsForMonth } from '../store/selectors';
import { useConfirm } from '../components/ConfirmProvider';
import { Field } from '../components/Field';
import { IconButton } from '../components/IconButton';
import {
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FileImage,
  LayoutDashboard,
  ListChecks,
  Plus,
  Trash2,
} from '../components/icons';
import type { ContentPlanBrand, ContentPlanPost } from '../types';
import { dayMonthLabel, isTodayStr, isWeekend, todayStr } from '../utils/dates';
import { tintVar } from '../utils/colors';

// Wejście widoku jest subtelne i dotyczy DWÓCH bloków (przegląd, siatka), a nie
// 31 kolumn dni — kaskada po dniach zamieniłaby otwarcie miesiąca w falę.
const cpSectionsVariants = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const cpSectionsVariantsStill = { hidden: {}, show: { transition: { staggerChildren: 0 } } };
const cpBlockVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } },
} as const;

export function ContentPlanPage() {
  const canView = useContentPlanAccess();
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const reduceMotion = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const today = todayStr();
  // Cała arytmetyka miesiąca (walidacja parametru, etykieta, sąsiedzi) siedzi w
  // czystym `contentPlanRoute.ts` — tutaj zostaje sam render.
  const pager = monthPagerFromParam(params.get(MONTH_PARAM), today);
  const currentMonth = resolveMonthParam(null, today);

  // Marka jest wyborem SESJI widoku (nie adresem): pager miesięcy zostaje
  // jedynym stanem w URL, tak jak zdefiniowała to poprzednia faza.
  const [requestedBrandId, setRequestedBrandId] = useState('');
  const [selectedPostId, setSelectedPostId] = useState('');
  const [copiedPost, setCopiedPost] = useState<ContentPlanPost | null>(null);

  const brands = state.contentPlanBrands;
  const brandOptions = useMemo(() => contentPlanBrandOptions(brands), [brands]);
  const brandId = resolveContentPlanBrandId(brands, requestedBrandId);
  const brand = brands.find((row) => row.id === brandId);
  const posts = contentPlanPostsForMonth(state, brandId, pager.key);
  const stats = contentPlanMonthStats(state, brandId, pager.key);
  const days = useMemo(() => monthKeyDays(pager.key), [pager.key]);
  const grid = useMemo(() => contentPlanDaysWithPosts(days, posts), [days, posts]);
  const decision = contentPlanDecisionMetric(stats);
  const channels = brand ? contentPlanPlatformBreakdown(brand, posts) : [];
  const sectionsVariants = reduceMotion ? cpSectionsVariantsStill : cpSectionsVariants;

  if (!canView) return <Navigate to={HOME_PATH} replace />;

  const goToMonth = (key: string) => {
    const next = new URLSearchParams(params);
    next.set(MONTH_PARAM, key);
    // `replace`: przewijanie miesięcy nie ma zasypywać historii przeglądarki
    // (Wstecz wraca tam, skąd użytkownik wszedł na moduł).
    setParams(next, { replace: true });
  };

  const addPost = (activeBrand: ContentPlanBrand, date: string) => {
    dispatch({ type: 'SAVE_CP_POST', postId: null, draft: contentPlanEmptyDraft(activeBrand, date) });
  };

  const pastePost = (activeBrand: ContentPlanBrand, date: string) => {
    if (!copiedPost) return;
    dispatch({
      type: 'SAVE_CP_POST',
      postId: null,
      draft: contentPlanPasteDraft(copiedPost, activeBrand, date),
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
    if (selectedPostId === post.id) setSelectedPostId('');
    if (copiedPost?.id === post.id) setCopiedPost(null);
  };

  const renderCard = (activeBrand: ContentPlanBrand, post: ContentPlanPost) => {
    const view = contentPlanCardView(activeBrand, post);
    const selected = post.id === selectedPostId;
    const published = post.visibility === 'published';
    return (
      <article key={post.id} className="cp-card" data-selected={selected ? 'true' : undefined}>
        <div className="cp-card-media" style={{ aspectRatio: view.aspectRatio }}>
          <FileImage size={20} aria-hidden />
          <span className="cp-card-media-label">
            {view.mediaFileId === ''
              ? 'Brak pliku'
              : view.isVideo
                ? 'Plik wideo z Dysku'
                : 'Plik graficzny z Dysku'}
          </span>
          {view.ratioLabel !== null && <span className="cp-ratio">{view.ratioLabel}</span>}
        </div>

        <div className="cp-card-head">
          <span className="cp-visibility" data-published={published ? 'true' : undefined}>
            {published ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
            {published ? 'Udostępniona' : 'Robocza'}
          </span>
          <div className="cp-card-actions">
            <IconButton
              size="sm"
              label={`Kopiuj publikację ${post.title}`}
              tooltip="Kopiuj"
              icon={<Copy size={14} aria-hidden />}
              pressed={copiedPost?.id === post.id}
              onClick={() => setCopiedPost(post)}
            />
            <IconButton
              size="sm"
              variant="danger"
              label={`Usuń publikację ${post.title}`}
              tooltip="Usuń"
              icon={<Trash2 size={14} aria-hidden />}
              onClick={() => {
                void deletePost(post);
              }}
            />
          </div>
        </div>

        {/* Zaznaczenie to WYŁĄCZNIE podświetlenie karty (przełącznik), a nie
            wejście w edycję — edytor publikacji wchodzi kolejną fazą. */}
        <button
          type="button"
          className="cp-card-title"
          aria-pressed={selected}
          onClick={() => setSelectedPostId(selected ? '' : post.id)}
        >
          {post.title}
        </button>

        <p className="cp-card-meta">
          <span>{post.topic === '' ? 'Bez tematu' : post.topic}</span>
          <span>{post.format === '' ? 'Bez formatu' : post.format}</span>
          <span>{post.status}</span>
        </p>

        {view.platforms.length > 0 && (
          // Nazwa listy idzie WIDOCZNĄ treścią dla czytnika (`sr-only`), a nie
          // `aria-label` na akapicie — na elemencie bez roli etykieta bywa
          // pomijana przez czytniki ekranu.
          <p className="cp-platforms">
            <span className="sr-only">Platformy: </span>
            {view.platforms.map((platform) => (
              <span
                key={platform.id}
                className="cp-platform"
                style={tintVar('--cp-platform', platform.color)}
              >
                {platform.name}
              </span>
            ))}
          </p>
        )}

        <p className="cp-card-copy">
          {view.primaryCopy === '' ? 'Brak opisu publikacji.' : view.primaryCopy}
        </p>

        {view.hasTags && <p className="cp-card-tags">Z tagami</p>}
      </article>
    );
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Content plan</h1>
        <div className="page-head-actions">
          <div className="cal-nav">
            <span className="cal-range-label">{pager.label}</span>
            <button
              type="button"
              className="nav-btn"
              aria-label="Poprzedni miesiąc"
              onClick={() => goToMonth(pager.prev)}
            >
              ‹
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={pager.key === currentMonth}
              onClick={() => goToMonth(currentMonth)}
            >
              Bieżący miesiąc
            </button>
            <button
              type="button"
              className="nav-btn"
              aria-label="Następny miesiąc"
              onClick={() => goToMonth(pager.next)}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {brand === undefined ? (
        <div className="empty-state">
          <p className="empty-title">Brak marek w module.</p>
          <p className="empty-hint">
            Kalendarz publikacji planuje się dla konkretnej marki. Zarządzanie markami i ich
            słownikami pojawi się w kolejnym kroku wdrożenia modułu.
          </p>
        </div>
      ) : (
        <m.div
          className="cp-layout"
          variants={sectionsVariants}
          initial="hidden"
          animate="show"
        >
          <m.div className="cp-toolbar" variants={cpBlockVariants}>
            <Field id="cp-brand" label="Marka" className="cp-brand-field">
              {(control) => (
                <select
                  {...control}
                  value={brandId}
                  onChange={(e) => {
                    setRequestedBrandId(e.target.value);
                    setSelectedPostId('');
                  }}
                >
                  {brandOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {copiedPost !== null && (
              <p className="cp-clipboard" role="status">
                <ClipboardPaste size={14} aria-hidden />W schowku: „{copiedPost.title}”. Wybierz
                dzień, w którym wkleić kopię.
                <button type="button" className="link-btn" onClick={() => setCopiedPost(null)}>
                  Wyczyść schowek
                </button>
              </p>
            )}
          </m.div>

          <m.section
            className="cp-overview"
            variants={cpBlockVariants}
            aria-label={`Podsumowanie planu: ${pager.label}`}
          >
            <div className="cp-overview-copy">
              <span className="cp-eyebrow">Przegląd miesiąca</span>
              <strong>{pager.label}</strong>
              <span className="cp-overview-hint">Stan pracy zespołu i gotowość do publikacji</span>
            </div>
            <div className="cp-metrics">
              <div className="cp-metric cp-metric-primary">
                <LayoutDashboard size={18} aria-hidden />
                <div>
                  <strong>{stats.total}</strong>
                  <span>wszystkie publikacje</span>
                </div>
              </div>
              <div className="cp-metric">
                <Eye size={17} aria-hidden />
                <div>
                  <strong>{stats.published}</strong>
                  <span>udostępnione</span>
                </div>
              </div>
              <div className="cp-metric">
                <ListChecks size={17} aria-hidden />
                <div>
                  <strong>{decision.value}</strong>
                  <span>{decision.label}</span>
                </div>
              </div>
            </div>
            {channels.length > 0 && (
              <p className="cp-channels">
                <span className="cp-channels-label">Kanały</span>
                {channels.map(({ platform, count }) => (
                  <span
                    key={platform.id}
                    className="cp-channel"
                    style={tintVar('--cp-platform', platform.color)}
                  >
                    <i className="cp-channel-dot" aria-hidden />
                    {platform.name} <b>{count}</b>
                  </span>
                ))}
              </p>
            )}
          </m.section>

          <m.div className="cp-grid" variants={cpBlockVariants}>
            {/* Dzień jest ZWYKŁYM kontenerem, nie `<section aria-label>`: 31
                nazwanych sekcji zrobiłoby z miesiąca 31 punktów orientacyjnych.
                Datę niesie widoczna treść nagłówka i nazwa przycisku dodawania. */}
            {grid.map((day) => (
              <div
                key={day.date}
                className="cp-day"
                data-today={isTodayStr(day.date) ? 'true' : undefined}
                data-weekend={isWeekend(day.date) ? 'true' : undefined}
              >
                <div className="cp-day-head">
                  <span className="cp-day-when">
                    <strong>{day.day}</strong>
                    <span>{day.weekday}</span>
                  </span>
                  <IconButton
                    size="sm"
                    label={`Dodaj publikację: ${dayMonthLabel(day.date)}`}
                    tooltip="Dodaj publikację"
                    icon={<Plus size={16} aria-hidden />}
                    onClick={() => addPost(brand, day.date)}
                  />
                </div>
                <div className="cp-day-posts">
                  {day.posts.map((post) => renderCard(brand, post))}
                  {copiedPost !== null && (
                    <button
                      type="button"
                      className="cp-paste"
                      onClick={() => pastePost(brand, day.date)}
                    >
                      <ClipboardPaste size={14} aria-hidden /> Wklej kopię
                    </button>
                  )}
                </div>
              </div>
            ))}
          </m.div>
        </m.div>
      )}
    </section>
  );
}
