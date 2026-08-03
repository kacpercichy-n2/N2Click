// Edytor publikacji Content Planu. Powłoka jest WSPÓLNA (`useModalShell`):
// scrim, pułapka i powrót fokusa, Escape, blokada scrolla, JEDEN scroller
// `.task-modal-body`. Montaż jest ŚWIADOMIE inny niż w TaskModal/EventModal —
// modal stoi WEWNĄTRZ `ContentPlanPage`, bo moduł jest bramkowany rolą i
// jednostronicowy, więc reużywa samo-guard strony zamiast dokładać czwarty
// globalny mount.
//
// MODEL EDYCJI: draft + JAWNY zapis (nie blur-commit jak w aplikacji źródłowej).
// Każda zmiana idzie w lokalny draft i podnosi flagę strażnika nawigacji, a
// „Zapisz zmiany" wysyła DOKŁADNIE JEDEN `SAVE_CP_POST` z etykietą historii z
// czystego `saveHistoryLabel`. Komentarze i decyzja klienta działają na ŻYWEJ
// publikacji ze stanu (własne akcje reduktora), nie na drafcie.
//
// GRANICE
// - Cała logika draftu: czysty `contentPlanPostEditor.ts` (testowany w node).
// - Zapis: WYŁĄCZNIE reduktor. Przed dispatchem stoi LUSTRO jego bramki
//   (`normalizeContentPlanPostDraft`) — odrzucony draft zostawia modal otwarty
//   i NIE czyści dirty, bo nieudany zapis nie może wyglądać jak sukces.
// - Media są tylko do ODCZYTU (referencja do pliku na Dysku): żadnego inputu
//   pliku ani base64 (wchodzi osobną fazą).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { m } from 'motion/react';
import { useStore } from '../store/AppStore';
import type { ContentPlanBrand, ContentPlanComment, ContentPlanPost } from '../types';
import {
  CONTENT_PLAN_STATUSES,
  formatCommentDate,
  MAIN_DESCRIPTION_GROUP,
  normalizeContentPlanPostDraft,
  validatePostForPublication,
  type ContentPlanPostDraft,
  type ContentPlanReviewDecision,
} from '../contentplan/domain';
import {
  buildPostDraft,
  canTogglePlatformOff,
  channelMediaView,
  draftDescriptionGroups,
  draftGroupTags,
  firstEmptyCopyGroupId,
  firstPostIssueField,
  mergeDescriptionGroup,
  POST_FIELD_IDS,
  postCopyFieldId,
  postIssueFocusId,
  postIssueLabels,
  postIssuesByField,
  postTagsFieldId,
  saveHistoryLabel,
  setGroupCopy,
  setGroupTags,
  splitDescriptionForPlatform,
  splitDescriptionOptions,
  threadedComments,
  togglePlatformInDraft,
} from './contentPlanPostEditor';
import { bypassNavGuardOnce, clearNavGuard, setNavGuard } from '../utils/dirtyRegistry';
import { useModalShell } from './useModalShell';
import { useConfirm } from './ConfirmProvider';
import { Field, focusFieldById } from './Field';
import { saveErrorSummary } from './fieldContract';
import { IconButton } from './IconButton';
import { tintVar } from '../utils/colors';
import {
  Check,
  CornerDownRight,
  FileImage,
  History,
  ListChecks,
  Megaphone,
  MessageSquare,
  Pencil,
  X,
} from './icons';

/** Parametr URL niosący edytor publikacji (polski, jak reszta tras). */
export const CONTENT_PLAN_POST_PARAM = 'publikacja';

/** Autor decyzji i komentarzy, gdy sesja nie wskazuje osoby. */
const FALLBACK_AUTHOR = 'Zespół N2';

interface ModalProps {
  postId: string;
  onClose: () => void;
}

export function ContentPlanPostModal({ postId, onClose }: ModalProps) {
  const { state } = useStore();
  const confirm = useConfirm();
  const post = state.contentPlanPosts.find((row) => row.id === postId);
  const brand = state.contentPlanBrands.find((row) => row.id === post?.brandId);
  const notFound = post === undefined || brand === undefined;

  const dirtyRef = useRef(false);
  const navGuardKey = useRef<object>({});
  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    setNavGuard(navGuardKey.current, 'contentplan-post-modal', dirty);
  }, []);
  useEffect(() => {
    const key = navGuardKey.current;
    return () => clearNavGuard(key);
  }, []);

  const closeDeliberately = useCallback(() => {
    bypassNavGuardOnce();
    onClose();
  }, [onClose]);

  // Pytanie o porzucenie zmian jest ASYNCHRONICZNE: drugie Escape w trakcie nie
  // może dołożyć drugiego pytania do kolejki.
  const askingRef = useRef(false);
  const requestClose = useCallback(async () => {
    if (askingRef.current) return;
    if (dirtyRef.current) {
      askingRef.current = true;
      const leave = await confirm({
        title: 'Masz niezapisane zmiany.',
        description: 'Zamknąć bez zapisywania?',
        confirmLabel: 'Zamknij bez zapisywania',
        cancelLabel: 'Wróć do edycji',
        // Bez `requireAck`: to porzucenie SZKICU, nie utrata zapisanych danych.
      });
      askingRef.current = false;
      if (!leave) return;
    }
    closeDeliberately();
  }, [closeDeliberately, confirm]);

  const titleId = useId();
  const { cardRef, cardProps, viewportProps } = useModalShell({
    onRequestClose: requestClose,
    labelledBy: titleId,
    // Modal z formularzem: tło nie zamyka (Escape i przyciski bez zmian).
    closeOnBackdrop: false,
  });

  return (
    <>
      <m.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" {...viewportProps}>
        <m.div
          ref={cardRef}
          className="task-modal-card cp-post-modal-card"
          {...cardProps}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="task-modal-head">
            <h1 className="task-modal-title" id={titleId}>
              {notFound ? 'Nie znaleziono publikacji' : 'Edytuj publikację'}
            </h1>
            <div className="task-modal-head-actions">
              <IconButton
                className="task-modal-close"
                icon={<X size={18} aria-hidden />}
                onClick={() => {
                  void requestClose();
                }}
                label="Zamknij"
              />
            </div>
          </div>
          <div className="task-modal-body">
            {notFound ? (
              <div className="empty-state">
                <p className="empty-title">Nie znaleziono publikacji</p>
                <p className="empty-hint">
                  Publikacja mogła zostać usunięta albo link jest nieaktualny.
                </p>
                <button type="button" className="btn primary" onClick={onClose}>
                  Zamknij
                </button>
              </div>
            ) : (
              <ContentPlanPostEditor
                key={postId}
                post={post}
                brand={brand}
                onDirtyChange={handleDirtyChange}
                onSaved={closeDeliberately}
                onCancel={() => {
                  void requestClose();
                }}
              />
            )}
          </div>
        </m.div>
      </div>
    </>
  );
}

interface EditorProps {
  post: ContentPlanPost;
  brand: ContentPlanBrand;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}

interface PostFieldErrors {
  title?: string;
  channels?: string;
  copy?: string;
  /** Grupa opisu, przy której wisi komunikat o braku treści. */
  copyGroupId?: string;
  /** Powód spoza pól (odrzucony draft) — ma pierwszeństwo w podsumowaniu. */
  form?: string;
}

/**
 * JEDNO źródło reguł pól edytora: używa go i zapis, i żywa rewalidacja. Tytuł
 * jest wymagany zawsze (reduktor go wymaga), a pełny komplet braków dotyczy
 * WYŁĄCZNIE udostępnienia klientowi — dokładnie ta sama funkcja, którą reduktor
 * egzekwuje przy zapisie.
 */
function computePostErrors(draft: ContentPlanPostDraft): PostFieldErrors {
  const errors: PostFieldErrors = {};
  if (draft.title.trim() === '') errors.title = 'Tytuł publikacji jest wymagany.';
  if (draft.visibility !== 'published') return errors;
  const byField = postIssuesByField(validatePostForPublication(draft));
  if (byField.title !== undefined) errors.title = byField.title;
  if (byField.channels !== undefined) errors.channels = byField.channels;
  if (byField.copy !== undefined) {
    errors.copy = byField.copy;
    errors.copyGroupId = firstEmptyCopyGroupId(draft) ?? MAIN_DESCRIPTION_GROUP;
  }
  return errors;
}

function hasPostErrors(errors: PostFieldErrors): boolean {
  return firstPostIssueField(errors) !== null;
}

function ContentPlanPostEditor({
  post,
  brand,
  onDirtyChange,
  onSaved,
  onCancel,
}: EditorProps) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<ContentPlanPostDraft>(() => buildPostDraft(post));
  const [errors, setErrors] = useState<PostFieldErrors>({});
  const [splitPlatformId, setSplitPlatformId] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [replyTargetId, setReplyTargetId] = useState('');
  const [replyBody, setReplyBody] = useState('');

  // Decyzje i komentarze podpisuje zalogowana osoba; brak sesji => nazwa zespołu
  // (reduktor odrzuca pustego autora).
  const author =
    state.people.find((person) => person.id === state.currentUserId)?.name.trim() ??
    FALLBACK_AUTHOR;
  const signature = author === '' ? FALLBACK_AUTHOR : author;

  /** Każda zmiana draftu podnosi flagę strażnika. Operacja bez skutku (np.
   *  próba wyłączenia ostatniego kanału) zwraca tę samą referencję i milczy. */
  const update = (next: ContentPlanPostDraft) => {
    if (next === draft) return;
    setDraft(next);
    onDirtyChange(true);
    // Żywa rewalidacja DOPIERO gdy formularz już raz pokazał błąd (wspólny model
    // czasowy kontraktu pola): poprawione pole gaśnie natychmiast, a czyste
    // milczy do próby zapisu. Odrzucony draft też przestaje straszyć po edycji.
    setErrors((current) =>
      current.form === undefined && !hasPostErrors(current) ? current : computePostErrors(next),
    );
  };

  const groups = draftDescriptionGroups(draft);
  const splitOptions = splitDescriptionOptions(draft, brand);
  // Widoczność sekcji klienta bierze się ze STANU STORE, nie z draftu: bramki
  // reduktora (`ADD_CP_COMMENT`, `REVIEW_CP_POST`) działają na zapisanej encji.
  const published = post.visibility === 'published';
  const threads = threadedComments(post.comments);

  // Wartość spoza słownika marki (osierocona zmianą słownika) zostaje na liście,
  // żeby select nie podmienił jej po cichu na pierwszą pozycję.
  const topicOptions =
    draft.topic === '' || brand.topics.includes(draft.topic)
      ? brand.topics
      : [draft.topic, ...brand.topics];
  const formatOptions =
    draft.format === '' || brand.formats.includes(draft.format)
      ? brand.formats
      : [draft.format, ...brand.formats];

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = computePostErrors(draft);
    if (hasPostErrors(next)) {
      setErrors(next);
      // Nieudany zapis MUSI mieć skutek: fokus na PIERWSZYM złym polu.
      const field = firstPostIssueField(next) ?? 'title';
      focusFieldById(postIssueFocusId(field, draft));
      return;
    }

    // LUSTRO bramki reduktora: draft odrzucony przez normalizację nie może
    // zamknąć modala „po cichu" (reduktor zwróciłby tę samą referencję stanu).
    if (normalizeContentPlanPostDraft(draft, state.contentPlanBrands) === null) {
      setErrors({ form: 'Nie udało się zapisać publikacji. Sprawdź wprowadzone dane.' });
      return;
    }

    const label = saveHistoryLabel(post, draft, brand);
    setErrors({});
    onDirtyChange(false);
    dispatch({
      type: 'SAVE_CP_POST',
      postId: post.id,
      draft,
      ...(label !== '' ? { historyLabel: label } : {}),
    });
    onSaved();
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Usunąć publikację „${post.title}”?`,
      consequences: 'To usunie treści kanałów, komentarze i historię tej publikacji.',
      confirmLabel: 'Usuń publikację',
      tone: 'danger',
    });
    if (!confirmed) return;
    onDirtyChange(false);
    dispatch({ type: 'DELETE_CP_POST', postId: post.id });
    onSaved();
  };

  const review = (decision: ContentPlanReviewDecision) => {
    dispatch({ type: 'REVIEW_CP_POST', postId: post.id, decision, author: signature });
    // Draft nie może pokazywać przeterminowanego statusu, ale to NIE jest zmiana
    // użytkownika — flaga niezapisanych zmian zostaje nietknięta.
    setDraft((current) => ({ ...current, status: decision }));
  };

  const addComment = (body: string, parentId?: string) => {
    const value = body.trim();
    if (value === '') return;
    dispatch({
      type: 'ADD_CP_COMMENT',
      postId: post.id,
      author: signature,
      body: value,
      ...(parentId !== undefined ? { parentId } : {}),
    });
    if (parentId === undefined) {
      setCommentBody('');
      return;
    }
    setReplyTargetId('');
    setReplyBody('');
  };

  // JEDNO ogłaszane podsumowanie na modal: powód odrzuconego draftu ma
  // pierwszeństwo, inaczej liczona lista złych pól (wzorzec `fieldContract`).
  const summaryLabels = postIssueLabels(errors);
  const summary =
    errors.form ??
    (summaryLabels.length > 0
      ? saveErrorSummary('Nie można zapisać publikacji', summaryLabels)
      : null);

  const renderComment = (comment: ContentPlanComment, repliedTo: ContentPlanComment | null) => (
    <article className="cp-comment">
      <p className="cp-comment-meta">
        <strong>{comment.author}</strong>
        <span>{formatCommentDate(comment.at)}</span>
      </p>
      {repliedTo !== null && (
        <p className="cp-comment-context">
          <CornerDownRight size={12} aria-hidden /> Odpowiedź do {repliedTo.author}
        </p>
      )}
      <p className="cp-comment-body">{comment.body}</p>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          setReplyTargetId(comment.id);
          setReplyBody('');
        }}
      >
        Odpowiedz
      </button>
      {replyTargetId === comment.id && (
        <div className="cp-reply">
          <Field id={`cp-post-reply-${comment.id}`} label={`Odpowiedź do ${comment.author}`}>
            {(control) => (
              <textarea
                {...control}
                rows={2}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
              />
            )}
          </Field>
          <div className="cp-reply-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setReplyTargetId('');
                setReplyBody('');
              }}
            >
              Anuluj
            </button>
            <button
              type="button"
              className="btn"
              disabled={replyBody.trim() === ''}
              onClick={() => addComment(replyBody, comment.id)}
            >
              Dodaj odpowiedź
            </button>
          </div>
        </div>
      )}
    </article>
  );

  return (
    <>
      {/* Formularz obejmuje WYŁĄCZNIE edytowalne pola publikacji: komentarze mają
          własny `<form>`, a zagnieżdżenie formularzy jest nielegalnym HTML-em. */}
      <form className="cp-post-form" onSubmit={handleSubmit} noValidate>
        <section className="cp-section">
          <h2 className="cp-section-title">
            <ListChecks size={16} aria-hidden /> Specyfikacja
          </h2>
          <div className="cp-post-grid">
            <Field id={POST_FIELD_IDS.date} label="Data">
              {(control) => (
                <input
                  {...control}
                  type="date"
                  value={draft.date}
                  onChange={(e) => update({ ...draft, date: e.target.value })}
                />
              )}
            </Field>
            <Field id={POST_FIELD_IDS.title} label="Tytuł roboczy *" error={errors.title}>
              {(control) => (
                <input
                  {...control}
                  data-autofocus
                  value={draft.title}
                  maxLength={300}
                  onChange={(e) => update({ ...draft, title: e.target.value })}
                />
              )}
            </Field>
            <Field id={POST_FIELD_IDS.topic} label="Temat">
              {(control) => (
                <select
                  {...control}
                  value={draft.topic}
                  onChange={(e) => update({ ...draft, topic: e.target.value })}
                >
                  <option value="">Bez tematu</option>
                  {topicOptions.map((topic) => (
                    <option key={topic} value={topic}>
                      {topic}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field id={POST_FIELD_IDS.format} label="Typ publikacji">
              {(control) => (
                <select
                  {...control}
                  value={draft.format}
                  onChange={(e) => update({ ...draft, format: e.target.value })}
                >
                  <option value="">Bez typu</option>
                  {formatOptions.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field id={POST_FIELD_IDS.status} label="Status">
              {(control) => (
                <select
                  {...control}
                  value={draft.status}
                  onChange={(e) =>
                    update({
                      ...draft,
                      status: e.target.value as ContentPlanPostDraft['status'],
                    })
                  }
                >
                  {CONTENT_PLAN_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              id={POST_FIELD_IDS.visibility}
              label="Widoczność"
              help="Udostępniona publikacja wymaga tytułu, platformy i opisu."
            >
              {(control) => (
                <select
                  {...control}
                  value={draft.visibility}
                  onChange={(e) =>
                    update({
                      ...draft,
                      visibility: e.target.value as ContentPlanPostDraft['visibility'],
                    })
                  }
                >
                  <option value="draft">Szkic (roboczy)</option>
                  <option value="published">Udostępniona klientowi</option>
                </select>
              )}
            </Field>
          </div>
        </section>

        <section className="cp-section">
          <h2 className="cp-section-title">
            <Megaphone size={16} aria-hidden /> Platformy
          </h2>
          {brand.platforms.length === 0 ? (
            <p className="field-hint">
              Marka nie ma jeszcze platform w słowniku. Uzupełnij je w edytorze marki.
            </p>
          ) : (
            <>
              <div className="cp-pills">
                {brand.platforms.map((platform, index) => {
                  const active = draft.channels.some(
                    (channel) => channel.platformId === platform.id,
                  );
                  const locked = active && !canTogglePlatformOff(draft, platform.id);
                  return (
                    <button
                      key={platform.id}
                      type="button"
                      // Kotwica fokusa sekcji: pierwsza pigułka kanału.
                      {...(index === 0 ? { id: POST_FIELD_IDS.platforms } : {})}
                      className="cp-pill"
                      aria-pressed={active}
                      disabled={locked}
                      style={tintVar('--cp-platform', platform.color)}
                      onClick={() => update(togglePlatformInDraft(draft, platform.id))}
                    >
                      <i className="cp-channel-dot" aria-hidden />
                      {platform.name}
                    </button>
                  );
                })}
              </div>
              <p className="field-hint">
                Nowa platforma dziedziczy opis główny. Ostatniego kanału nie da się wyłączyć.
              </p>
            </>
          )}
          {errors.channels !== undefined && <p className="field-error">{errors.channels}</p>}
        </section>

        <section className="cp-section">
          <h2 className="cp-section-title">
            <Pencil size={16} aria-hidden /> Opisy
          </h2>
          <div className="cp-split">
            <Field id="cp-post-split" label="Wydziel opis dla platformy">
              {(control) => (
                <select
                  {...control}
                  value={splitPlatformId}
                  disabled={splitOptions.length === 0}
                  onChange={(e) => setSplitPlatformId(e.target.value)}
                >
                  <option value="">Wybierz platformę</option>
                  {splitOptions.map((option) => (
                    <option key={option.platformId} value={option.platformId}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              type="button"
              className="btn ghost"
              disabled={splitPlatformId === ''}
              onClick={() => {
                update(splitDescriptionForPlatform(draft, splitPlatformId));
                setSplitPlatformId('');
              }}
            >
              Wydziel opis
            </button>
          </div>

          {groups.map((group) => (
            <section
              key={group.id}
              className="cp-desc-group"
              data-main={group.isMain ? 'true' : undefined}
            >
              <div className="cp-desc-head">
                <div className="cp-desc-copy">
                  <strong>{group.isMain ? 'Opis główny' : 'Opis dedykowany'}</strong>
                  <span>
                    {group.isMain
                      ? 'Domyślna treść dla platform bez wydzielonego wariantu.'
                      : 'Osobna treść tylko dla wskazanych platform.'}
                  </span>
                </div>
                {!group.isMain && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => update(mergeDescriptionGroup(draft, group.id))}
                  >
                    Scal z opisem głównym
                  </button>
                )}
              </div>

              <p className="cp-desc-platforms">
                {group.channels.map((channel) => {
                  const media = channelMediaView(brand, channel, draft.format);
                  return (
                    <span
                      key={channel.id}
                      className="cp-platform"
                      style={tintVar('--cp-platform', media.platformColor)}
                    >
                      {media.platformName}
                    </span>
                  );
                })}
              </p>

              <Field
                id={postCopyFieldId(group.id)}
                label="Opis"
                error={errors.copyGroupId === group.id ? errors.copy : undefined}
              >
                {(control) => (
                  <textarea
                    {...control}
                    rows={4}
                    value={group.channels[0]?.copy ?? ''}
                    placeholder="Treść publikacji dla tych platform"
                    onChange={(e) => update(setGroupCopy(draft, group.id, e.target.value))}
                  />
                )}
              </Field>
              <Field
                id={postTagsFieldId(group.id)}
                label="Tagi"
                {...(group.isMain
                  ? { help: 'Tagi opisu głównego dziedziczą wszystkie warianty bez własnych.' }
                  : {})}
              >
                {(control) => (
                  <input
                    {...control}
                    value={draftGroupTags(draft, group)}
                    placeholder="#marka #kampania"
                    onChange={(e) => update(setGroupTags(draft, group.id, e.target.value))}
                  />
                )}
              </Field>

              {/* Pliki są TYLKO do odczytu: referencja do Dysku wchodzi osobną
                  fazą, tutaj kadr trzyma samą proporcję. */}
              <ul className="cp-media-list">
                {group.channels.map((channel) => {
                  const media = channelMediaView(brand, channel, draft.format);
                  return (
                    <li key={channel.id} className="cp-media-row">
                      <span
                        className="cp-media-thumb"
                        style={{ aspectRatio: media.aspectRatio }}
                        aria-hidden
                      >
                        <FileImage size={14} />
                      </span>
                      <strong>{media.platformName}</strong>
                      <span className="cp-media-file" data-empty={media.hasFile ? undefined : 'true'}>
                        {media.fileLabel}
                      </span>
                      {media.ratioLabel !== null && (
                        <span className="cp-ratio-badge">{media.ratioLabel}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>

        {summary !== null && (
          <p className="field-error" role="alert">
            {summary}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn primary">
            Zapisz zmiany
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Anuluj
          </button>
          <button
            type="button"
            className="btn danger-ghost"
            onClick={() => {
              void handleDelete();
            }}
          >
            Usuń publikację
          </button>
        </div>
      </form>

      <section className="cp-section">
        <h2 className="cp-section-title">
          <Check size={16} aria-hidden /> Decyzja klienta
        </h2>
        {published ? (
          <>
            <div className="cp-review">
              <button type="button" className="btn" onClick={() => review('Akceptacja')}>
                Akceptuję
              </button>
              <button type="button" className="btn" onClick={() => review('Uwagi')}>
                Zgłoś uwagi
              </button>
            </div>
            <p className="field-hint">
              Decyzję rejestruje zespół w imieniu klienta. Trafia do statusu i historii zmian.
            </p>
          </>
        ) : (
          <p className="field-hint">
            Decyzja klienta będzie dostępna po udostępnieniu publikacji klientowi.
          </p>
        )}
      </section>

      <section className="cp-section">
        <h2 className="cp-section-title">
          <MessageSquare size={16} aria-hidden /> Komentarze
        </h2>
        {published ? (
          <>
            <form
              className="cp-comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                addComment(commentBody);
              }}
            >
              <Field id="cp-post-comment" label="Nowy komentarz">
                {(control) => (
                  <textarea
                    {...control}
                    rows={3}
                    value={commentBody}
                    placeholder="Dodaj uwagę do tej publikacji"
                    onChange={(e) => setCommentBody(e.target.value)}
                  />
                )}
              </Field>
              <button type="submit" className="btn" disabled={commentBody.trim() === ''}>
                Dodaj komentarz
              </button>
            </form>
            {threads.length === 0 ? (
              <p className="field-hint">Brak komentarzy. Dodaj pierwszą uwagę do tej publikacji.</p>
            ) : (
              <ul className="cp-thread-list">
                {threads.map((thread) => (
                  <li key={thread.comment.id} className="cp-thread">
                    {renderComment(thread.comment, null)}
                    {thread.replies.length > 0 && (
                      <ul className="cp-replies">
                        {thread.replies.map((reply) => (
                          <li key={reply.comment.id}>
                            {renderComment(reply.comment, reply.repliedTo)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="field-hint">
            Komentarze będą dostępne po udostępnieniu publikacji klientowi.
          </p>
        )}
      </section>

      <section className="cp-section">
        <h2 className="cp-section-title">
          <History size={16} aria-hidden /> Historia zmian
        </h2>
        {post.history.length === 0 ? (
          <p className="field-hint">Brak wpisów historii.</p>
        ) : (
          <ol className="cp-history">
            {post.history.map((entry) => (
              <li key={entry.id} className="cp-history-item">
                <strong>{entry.label}</strong>
                <span>{formatCommentDate(entry.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
