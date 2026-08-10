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
// - Media wskazuje Picker Dysku Google (`contentplan/google.ts`): do draftu
//   wchodzi WYŁĄCZNIE referencja `{ source: 'gdrive', fileId, ... }`. Żadnego
//   inputu pliku, uploadu ani base64 — plik zostaje na Dysku. Sam wybór jest
//   asynchroniczny, więc stan draftu zmienia go przez `setChannelMedia` na
//   AKTUALNEJ referencji (`draftRef`), nie na tej z chwili kliknięcia.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { m } from 'motion/react';
import { useStore } from '../store/AppStore';
import type { ContentPlanBrand, ContentPlanComment, ContentPlanPost } from '../types';
import {
  CONTENT_PLAN_STATUSES,
  formatCommentDate,
  MAIN_DESCRIPTION_GROUP,
  makeEmptyPost,
  mediaAspectRatio,
  monthKeyOf,
  normalizeContentPlanPostDraft,
  platformFor,
  splitContentPlanTags,
  validatePostForPublication,
  type ContentPlanPostDraft,
} from '../contentplan/domain';
import {
  CONTENT_PLAN_STATUS_META,
  CONTENT_PLAN_STATUS_STEPS,
} from '../contentplan/glassView';
import { CpMediaThumb, CpPlatformChip } from './ContentPlanGlass';
import { formatShortWithWeekday, isValidDateStr } from '../utils/dates';
import {
  driveErrorMessage,
  driveThumbUrl,
  driveViewUrl,
  googleDriveDisabledReason,
  mediaFromPickerSelection,
  pickerParentId,
  pickFolderFromDrive,
  pickFromDrive,
  shareFilePublic,
} from '../contentplan/google';
import { loadDriveFolder, rememberDriveFolder } from '../contentplan/driveFolders';
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
  setChannelMedia,
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
import { DisabledHint } from './Tooltip';
import { tintVar } from '../utils/colors';
import {
  CornerDownRight,
  FileImage,
  FolderOpen,
  History,
  ListChecks,
  Megaphone,
  MessageSquare,
  Pencil,
  X,
} from './icons';

/** Parametr URL niosący edytor publikacji (polski, jak reszta tras). */
export const CONTENT_PLAN_POST_PARAM = 'publikacja';

/**
 * Wartość parametru dla NOWEJ publikacji: `new:<brandId>:<yyyy-MM-dd>` (slug
 * marki nie zawiera dwukropka). Parytet z aplikacją źródłową: kliknięcie
 * „+ Nowa publikacja" / „+" na dniu otwiera edytor z pustym szkicem, a encja
 * powstaje DOPIERO przy zapisie — anulowanie niczego nie zostawia w planie.
 */
export function contentPlanNewPostParam(brandId: string, date: string): string {
  return `new:${brandId}:${date}`;
}

/** Autor decyzji i komentarzy, gdy sesja nie wskazuje osoby. */
const FALLBACK_AUTHOR = 'Zespół N2';

/** Znacznik „otwarte okno wyboru FOLDERU" (kanały używają własnych id). */
const FOLDER_BUSY_KEY = 'folder';

interface ModalProps {
  postId: string;
  onClose: () => void;
}

export function ContentPlanPostModal({ postId, onClose }: ModalProps) {
  const { state } = useStore();
  const confirm = useConfirm();
  // Tryb tworzenia (`new:<brandId>:<data>`): encji NIE ma w store — edytor
  // dostaje syntetyczny pusty szkic (memoizowany, żeby id kanałów nie
  // rotowały między renderami), a zapis idzie z `postId: null`.
  const newParts = postId.startsWith('new:') ? postId.slice(4).split(':') : null;
  const isNew = newParts !== null;
  const newBrand = isNew
    ? state.contentPlanBrands.find((row) => row.id === newParts[0])
    : undefined;
  const newDate = isNew ? (newParts[1] ?? '') : '';
  const syntheticPost = useMemo(
    () =>
      newBrand !== undefined && isValidDateStr(newDate)
        ? makeEmptyPost(newBrand, newDate)
        : undefined,
    [newBrand, newDate],
  );
  const storedPost = isNew
    ? undefined
    : state.contentPlanPosts.find((row) => row.id === postId);
  const post = isNew ? syntheticPost : storedPost;
  const brand = isNew
    ? newBrand
    : state.contentPlanBrands.find((row) => row.id === storedPost?.brandId);
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
  const formId = useId();
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
          className="task-modal-card cp-post-modal-card cp-glass-modal"
          {...cardProps}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="task-modal-head">
            <h1 className="task-modal-title" id={titleId}>
              {notFound ? 'Nie znaleziono publikacji' : isNew ? 'Nowa publikacja' : 'Edytuj publikację'}
            </h1>
            <div className="task-modal-head-actions">
              {/* Zapis stoi w NAGŁÓWKU (parytet ze źródłem — odzyskany wiersz):
                  przycisk celuje w formularz edytora atrybutem `form`. */}
              {!notFound && (
                <>
                  <button type="submit" form={formId} className="btn primary">
                    {isNew ? 'Utwórz publikację' : 'Zapisz zmiany'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      void requestClose();
                    }}
                  >
                    Anuluj
                  </button>
                </>
              )}
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
                formId={formId}
                isNew={isNew}
                onDirtyChange={handleDirtyChange}
                onSaved={closeDeliberately}
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
  /** Id formularza — przyciski zapisu stoją w NAGŁÓWKU modala (atrybut `form`). */
  formId: string;
  /** Tryb tworzenia: `post` jest syntetycznym szkicem spoza store — zapis
   *  tworzy encję (`postId: null`), a sekcje żywej encji są ukryte. */
  isNew: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
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

/**
 * Kolumna podglądu „jak na telefonie" (port 1:1 kolumny trzeciej edytora
 * Studio): avatar + handle marki, media kanału w proporcji formatu, treść
 * aktywnego kanału z tagami i linia statusu z etapem workflow. CZYSTY render
 * draftu — podgląd żyje razem z edycją, zanim cokolwiek trafi do store.
 */
function CpPhonePreview({
  brand,
  draft,
}: {
  brand: ContentPlanBrand;
  draft: ContentPlanPostDraft;
}) {
  const [previewChannelId, setPreviewChannelId] = useState('');
  const channel = draft.channels.find((row) => row.id === previewChannelId) ?? draft.channels[0];
  const platform = channel !== undefined ? platformFor(brand, channel.platformId) : undefined;
  const tags = splitContentPlanTags(
    channel !== undefined && channel.overrideTags ? channel.tags : draft.baseTags,
  );
  const handle = brand.contact !== '' ? brand.contact : brand.name;
  const meta = CONTENT_PLAN_STATUS_META[draft.status];
  return (
    <div className="cp-phone-wrap">
      {draft.channels.length > 1 && (
        <div className="cp-phone-tabs" role="tablist" aria-label="Platforma podglądu">
          {draft.channels.map((row) => {
            const rowPlatform = platformFor(brand, row.platformId);
            if (!rowPlatform) return null;
            const on = row.id === channel?.id;
            return (
              <button
                key={row.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`cp-phone-tab${on ? ' on' : ''}`}
                onClick={() => setPreviewChannelId(row.id)}
              >
                <CpPlatformChip platform={rowPlatform} size={15} />
              </button>
            );
          })}
        </div>
      )}
      <div className="cp-phone">
        <div className="cp-phone-head">
          <span
            className="cp-phone-avatar"
            style={{ background: brand.accent || 'var(--n2-lavender)' }}
            aria-hidden
          >
            {brand.name.slice(0, 2).toLocaleUpperCase('pl-PL')}
          </span>
          <div>
            <b>{handle}</b>
            <span>{platform !== undefined ? platform.name : 'Brak platformy'}</span>
          </div>
        </div>
        {channel?.media !== undefined ? (
          <CpMediaThumb
            media={channel.media}
            className="cp-phone-media"
            aspectRatio={mediaAspectRatio(channel, draft.format)}
          />
        ) : (
          <div
            className="cp-phone-media empty"
            style={{ aspectRatio: mediaAspectRatio(undefined, draft.format) }}
          >
            brak media
          </div>
        )}
        <div className="cp-phone-caption">
          <b>{handle}</b>{' '}
          {channel !== undefined && channel.copy.trim() !== '' ? (
            channel.copy
          ) : (
            <span className="cp-phone-placeholder">tu pojawi się treść…</span>
          )}
          {tags.length > 0 && (
            <span className="cp-phone-tags">
              {' '}
              {tags.slice(0, 6).join(' ')}
              {tags.length > 6 ? ' …' : ''}
            </span>
          )}
        </div>
      </div>
      <p className="cp-phone-note">
        Podgląd na żywo — tak zobaczy tę publikację klient przy akceptacji.
      </p>
      <div className="cp-phone-status">
        <i style={{ background: meta.color }} aria-hidden />
        {draft.status} · etap {meta.step}/{CONTENT_PLAN_STATUS_STEPS}
      </div>
    </div>
  );
}

function ContentPlanPostEditor({
  post,
  brand,
  formId,
  isNew,
  onDirtyChange,
  onSaved,
}: EditorProps) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<ContentPlanPostDraft>(() => buildPostDraft(post));
  const [errors, setErrors] = useState<PostFieldErrors>({});
  // Środkowa kolumna: POST (opisy publikacji) / DESIGN (wytyczne dla grafika) —
  // jeden przełącznik podmienia dostępne pola tekstowe (zgłoszenie 2026-08-07).
  // Publikacja z wpisanymi wytycznymi otwiera się na POST tak samo — treść
  // posta zostaje pierwszym widokiem edycji.
  const [copyMode, setCopyMode] = useState<'post' | 'design'>('post');
  const [splitPlatformId, setSplitPlatformId] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [replyTargetId, setReplyTargetId] = useState('');
  const [replyBody, setReplyBody] = useState('');
  // Otwarte okno Google: id kanału albo `FOLDER_BUSY_KEY` (`null` = bezczynne).
  const [driveBusy, setDriveBusy] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveNotice, setDriveNotice] = useState<string | null>(null);

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

  // Wybór pliku jest ASYNCHRONICZNY (okno Google), więc zapis media musi trafić
  // w draft AKTUALNY w chwili powrotu z Pickera, nie w ten z chwili kliknięcia.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Miesiąc publikacji jest kluczem pamięci folderów marki (pusty = zła data).
  const monthKey = monthKeyOf(draft.date);
  const driveReason = googleDriveDisabledReason();

  const pickFolderParent = async (): Promise<string | null> =>
    monthKey === '' ? null : await loadDriveFolder(brand.id, monthKey);

  const pickChannelMedia = async (channelId: string) => {
    setDriveBusy(channelId);
    setDriveError(null);
    setDriveNotice(null);
    try {
      const parentId = await pickFolderParent();
      const documents = await pickFromDrive(parentId !== null ? { parentId } : {});
      if (documents === null) return; // anulowane w oknie Google
      const media = mediaFromPickerSelection(documents);
      if (media === null) {
        setDriveNotice('Nie wybrano pliku, który da się podpiąć do publikacji.');
        return;
      }
      const next = setChannelMedia(draftRef.current, channelId, media);
      if (next !== draftRef.current) update(next);
      if (documents.length > 1) {
        setDriveNotice(
          `Wybrano plików: ${documents.length}. Podpięty jest pierwszy, pozostałe dodaj przy innych platformach.`,
        );
      }
      // Pamięć folderu i publiczny link to WYGODA: obie operacje są
      // best-effort i nigdy nie blokują edycji.
      const parent = pickerParentId(documents);
      if (parent !== null && monthKey !== '') {
        void rememberDriveFolder(brand.id, monthKey, parent);
      }
      void shareFilePublic(media.fileId);
    } catch (error) {
      setDriveError(driveErrorMessage(error));
    } finally {
      setDriveBusy(null);
    }
  };

  const pickBrandFolder = async () => {
    setDriveBusy(FOLDER_BUSY_KEY);
    setDriveError(null);
    setDriveNotice(null);
    try {
      const parentId = await pickFolderParent();
      const folder = await pickFolderFromDrive(parentId !== null ? { parentId } : {});
      if (folder === null) return;
      if (monthKey === '') {
        setDriveError('Ustaw poprawną datę publikacji, zanim zapamiętasz folder marki.');
        return;
      }
      await rememberDriveFolder(brand.id, monthKey, folder.id);
      setDriveNotice(
        folder.name === ''
          ? 'Zapamiętano folder marki dla tego miesiąca.'
          : `Zapamiętano folder „${folder.name}” dla tego miesiąca.`,
      );
    } catch (error) {
      setDriveError(driveErrorMessage(error));
    } finally {
      setDriveBusy(null);
    }
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
      // Nieudany zapis MUSI mieć skutek: fokus na PIERWSZYM złym polu. Pola
      // opisów żyją w widoku POST — otwarta zakładka DESIGN by go ukryła,
      // więc skok najpierw wraca na POST (fokus po commicie renderu).
      setCopyMode('post');
      const field = firstPostIssueField(next) ?? 'title';
      requestAnimationFrame(() => focusFieldById(postIssueFocusId(field, draft)));
      return;
    }

    // LUSTRO bramki reduktora: draft odrzucony przez normalizację nie może
    // zamknąć modala „po cichu" (reduktor zwróciłby tę samą referencję stanu).
    if (normalizeContentPlanPostDraft(draft, state.contentPlanBrands) === null) {
      setErrors({ form: 'Nie udało się zapisać publikacji. Sprawdź wprowadzone dane.' });
      return;
    }

    // Tworzenie: reduktor sam dopisuje wpis „Utworzono slot publikacji" —
    // etykieta diffu porównywałaby draft z syntetycznym szkicem, nie z encją.
    const label = isNew ? '' : saveHistoryLabel(post, draft, brand);
    setErrors({});
    onDirtyChange(false);
    dispatch({
      type: 'SAVE_CP_POST',
      postId: isNew ? null : post.id,
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
    // Układ „Studio" 1:1 ze źródłem: pasek akcji u góry i trzy kolumny
    // (plan | treść | podgląd), każda z własnym scrollerem. Wszystkie kontrolki
    // stoją w JEDNYM formularzu — dawny wewnętrzny formularz komentarza jest
    // divem z przyciskiem type="button" (zagnieżdżony <form> to nielegalny HTML).
    <form id={formId} className="cp-post-form cp-pe-form" onSubmit={handleSubmit} noValidate>
      <div className="cp-pe-body">
        <div className="cp-pe-col cp-pe-col-plan">
        <section className="cp-section">
          <h2 className="cp-section-title">
            <ListChecks size={16} aria-hidden /> Specyfikacja
          </h2>
          <div className="cp-post-grid">
            {/* Nazwa dnia NA ŻYWO przy dacie (zgłoszenie 2026-08-07) — natywne
                pole nie niesie dnia tygodnia, więc podpis liczy go z draftu. */}
            <Field
              id={POST_FIELD_IDS.date}
              label="Data"
              {...(isValidDateStr(draft.date) ? { help: formatShortWithWeekday(draft.date) } : {})}
            >
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

        {/* Media stoją w JEDNEJ sekcji (a nie w grupach opisów): plik jest
            własnością KANAŁU, a grupa opisu tylko dzieli treść, więc ta sama
            platforma nie powtarzałaby się w dwóch listach. */}
        <section className="cp-section">
          <h2 className="cp-section-title">
            <FileImage size={16} aria-hidden /> Media z Dysku Google
          </h2>
          <div className="cp-media-toolbar">
            <DisabledHint reason={driveReason} id="cp-post-drive-folder-hint">
              <button
                type="button"
                className="btn ghost"
                disabled={driveReason !== null || driveBusy !== null}
                onClick={() => {
                  void pickBrandFolder();
                }}
              >
                <FolderOpen size={14} aria-hidden /> Wskaż folder marki
              </button>
            </DisabledHint>
            <p className="field-hint">
              Wybór plików startuje w folderze zapamiętanym dla marki i miesiąca publikacji. Pliki
              zostają na Dysku, w publikacji zapisujemy sam identyfikator.
            </p>
          </div>

          {draft.channels.length === 0 ? (
            <p className="field-hint">Dodaj platformę, żeby podpiąć do niej plik z Dysku.</p>
          ) : (
            <ul className="cp-media-list">
              {draft.channels.map((channel) => {
                const media = channelMediaView(brand, channel, draft.format);
                const fileId = channel.media?.fileId ?? '';
                return (
                  <li key={channel.id} className="cp-media-row">
                    <span
                      className="cp-media-thumb"
                      style={{ aspectRatio: media.aspectRatio }}
                      data-file={media.hasFile ? 'true' : undefined}
                      aria-hidden
                    >
                      {media.hasFile ? (
                        <img src={driveThumbUrl(fileId, 160)} alt="" loading="lazy" />
                      ) : (
                        <FileImage size={14} />
                      )}
                    </span>
                    <strong>{media.platformName}</strong>
                    <span className="cp-media-file" data-empty={media.hasFile ? undefined : 'true'}>
                      {media.fileLabel}
                    </span>
                    {media.ratioLabel !== null && (
                      <span className="cp-ratio-badge">{media.ratioLabel}</span>
                    )}
                    <span className="cp-media-actions">
                      <DisabledHint reason={driveReason} id={`cp-post-drive-${channel.id}-hint`}>
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={driveReason !== null || driveBusy !== null}
                          onClick={() => {
                            void pickChannelMedia(channel.id);
                          }}
                        >
                          {media.hasFile ? 'Zmień plik' : 'Wybierz z Dysku'}
                        </button>
                      </DisabledHint>
                      {media.hasFile && (
                        <>
                          <a
                            className="link-btn"
                            href={driveViewUrl(fileId)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Otwórz na Dysku
                          </a>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => update(setChannelMedia(draft, channel.id, null))}
                          >
                            Usuń plik
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {driveNotice !== null && <p className="field-hint">{driveNotice}</p>}
          {driveError !== null && (
            <p className="field-error" role="alert">
              {driveError}
            </p>
          )}
        </section>
          {!isNew && (
            <button
              type="button"
              className="btn danger-ghost cp-pe-delete"
              onClick={() => {
                void handleDelete();
              }}
            >
              Usuń publikację
            </button>
          )}
        </div>

        <div className="cp-pe-col cp-pe-col-copy">
          {summary !== null && (
            <p className="field-error" role="alert">
              {summary}
            </p>
          )}

        {/* POST / DESIGN — przełącznik treści środkowej kolumny (te same style
            co przełącznik Tablica/Rejestr strony). Pola nieaktywnego widoku są
            odmontowane, ale ich wartości żyją w drafcie, więc nic nie ginie. */}
        <div className="cp-mode cp-copy-mode" role="tablist" aria-label="Rodzaj treści">
          <button
            type="button"
            role="tab"
            aria-selected={copyMode === 'post'}
            className={`cp-mode-btn${copyMode === 'post' ? ' on' : ''}`}
            onClick={() => setCopyMode('post')}
          >
            POST
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={copyMode === 'design'}
            className={`cp-mode-btn${copyMode === 'design' ? ' on' : ''}`}
            onClick={() => setCopyMode('design')}
          >
            DESIGN
            {draft.designBrief.trim() !== '' && (
              <i className="cp-copy-mode-dot" aria-label="Wytyczne uzupełnione" />
            )}
          </button>
        </div>

        {copyMode === 'design' && (
          <section className="cp-section">
            <h2 className="cp-section-title">
              <FileImage size={16} aria-hidden /> Wytyczne dla grafika
            </h2>
            <Field
              id="cp-post-design-brief"
              label="Design"
              help="Treści na grafikę, opis kadru, kolory, CTA — wszystko, czego grafik potrzebuje do tej publikacji."
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={14}
                  value={draft.designBrief}
                  placeholder="Np. nagłówek na grafice, tekst na slajdach, moodboard, format eksportu…"
                  onChange={(e) => update({ ...draft, designBrief: e.target.value })}
                />
              )}
            </Field>
          </section>
        )}

        {copyMode === 'post' && (
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

            </section>
          ))}
        </section>
        )}


      {/* Sekcje ŻYWEJ encji (komentarze, historia) nie istnieją przed
          pierwszym zapisem — akcje reduktora adresują publikację po id.
          Sekcja „Decyzja klienta" WYLECIAŁA z edytora (decyzja usera
          2026-08-10): decyzję podejmuje klient w swoim portalu, zespół nie
          klika jej z tego miejsca. Akcja REVIEW_CP_POST zostaje w reduktorze
          (portal / decyzje klienta wchodzą tamtędy). */}
      {!isNew && (
      <>
      <section className="cp-section">
        <h2 className="cp-section-title">
          <MessageSquare size={16} aria-hidden /> Komentarze
        </h2>
        {published ? (
          <>
            <div className="cp-comment-form">
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
              <button
                type="button"
                className="btn"
                disabled={commentBody.trim() === ''}
                onClick={() => addComment(commentBody)}
              >
                Dodaj komentarz
              </button>
            </div>
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
      )}
        </div>

        <div className="cp-pe-col cp-pe-col-preview">
          <CpPhonePreview brand={brand} draft={draft} />
        </div>
      </div>
    </form>
  );
}
