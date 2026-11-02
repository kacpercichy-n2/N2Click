// Wątek rozmowy: lista wiadomości + kompozytor. JEDNA implementacja, dwie
// powłoki (karta zadania v2): okno doku (`variant="dock"`, nagłówek, motyw,
// minimalizacja) i panel rozmowy w karcie zadania (`variant="pane"`, bez
// nagłówka; nagłówek „Rozmowa” rysuje `TaskConversationPane`).
//
// DECYZJE:
//   * Stan wątku (wiadomości, reakcje, „pisze…", paginacja) żyje w
//     `ChatProvider.threads[conversation.id]`. Dok i panel zadania mogą
//     pokazywać RÓŻNE rozmowy naraz; każda akcja niesie id rozmowy.
//   * `markRead` NIE jest tu wołane: robi to provider po wczytaniu pierwszej
//     strony i przy każdej cudzej wiadomości w oglądanym wątku.
//   * Okno doku NIE jest modalem: bez pułapki fokusa, bez blokady scrolla.
//     Escape zamyka okno doku, gdy fokus jest w środku (panel zadania nie
//     przechwytuje Escape: należy do karty).
//   * Dosuwanie scrolla działa tylko wtedy, gdy użytkownik JEST przy dole.
//   * TREŚĆ DYMKA idzie przez czysty `chatRichText.ts` (linki jako dane, nigdy
//     `dangerouslySetInnerHTML`), wzmianki podświetla `mentionSegments`.
//   * AKCJE WIADOMOŚCI (Odpowiedz, Reakcja, Przypnij/Odepnij, Edytuj, Usuń):
//     menu `OverflowMenu` przy dymku, widoczne na hover i fokus (klawiatura:
//     Tab do przycisku, Enter, strzałki). Na dotyku menu otwiera DŁUGIE
//     PRZYTRZYMANIE dymka (400 ms, anulowane ruchem > 8 px). Przycisk
//     „Zareaguj" z szybkim paskiem zostaje jak w doku.
//   * EDYCJA dzieje się w kompozytorze (pasek „Edytujesz wiadomość”), szkic
//     nowej wiadomości czeka nietknięty. USUNIĘCIE wymaga potwierdzenia w tym
//     samym miejscu (operacja nie ma „cofnij”).
//   * OBRAZY (L2, `src/chat/attachments`): wklejenie, upuszczenie na wątek,
//     przycisk pliku. Kolejka wgrywa od razu; wysyłka czeka, aż wszystkie są
//     gotowe, i czyści kolejkę dopiero po sukcesie.
//   * SZKIC JEST WŁASNOŚCIĄ POWŁOKI (`draft` / `onDraftChange`): dok trzyma
//     szkice per rozmowa, panel zadania własny stan. Enter pustoszy pole od
//     razu, nieudana wysyłka oddaje treść przez `onDraftRestore`.
//   * „WIDZIANE PRZEZ” (Messenger): awatar każdego członka pod najnowszą
//     wiadomością, którą przeczytał (`seenByMessage`), dymek z nazwiskiem
//     i godziną. Na żywo przez zdarzenie `read`.
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
// Ikony spoza kuratorowanego `components/icons.ts` (plik wspólny, poza L3).
import { AtSign, ImagePlus, Pin } from 'lucide-react';
import {
  ChevronDown,
  ImagePlay,
  Palette,
  Send,
  Smile,
  SmilePlus,
  X,
} from '../../components/icons';
import { OverflowMenu } from '../../components/OverflowMenu';
import { Tooltip } from '../../components/Tooltip';
import { mentionQueryAt } from '../../components/mentionAutocomplete';
import { todayStr } from '../../utils/dates';
import { getSupabaseClient } from '../../supabase/client';
import {
  AttachmentGrid,
  AttachmentTray,
  DropZoneOverlay,
  createAttachmentStorage,
  useAttachmentQueue,
} from '../attachments';
import { useChat } from '../ChatProvider';
import {
  EMPTY_THREAD,
  groupReactions,
  ownReaction,
  pinnedMessages,
  seenByMessage,
  typingUserIds,
} from '../chatState';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_QUICK_REACTIONS, type ChatConversation } from '../types';
import { themeById } from '../themes/catalog';
import { themeCssVars } from '../themes/themeVars';
import { ChatAvatar } from './ChatAvatar';
import { ChatEmojiPopover } from './ChatEmojiPopover';
import { ChatGifImage } from './ChatGifImage';
import { ChatGifPopover } from './ChatGifPopover';
import { ReactionBar, ReactionPills } from './ChatReactions';
import { ChatThemePicker } from './ChatThemePicker';
import { emojiLabel, insertAtCaret, pushRecentEmoji, replaceEmoticons } from './chatEmoji';
import { klipyApiKey } from './chatGifs';
import {
  conversationInitials,
  directPeerId,
  isConversationOnline,
  personFirstName,
  personInitials,
  type ChatDirectory,
  type ChatPerson,
} from './chatPeople';
import {
  gifAttribution,
  messageContentKind,
  tokenizeMessage,
  type ChatContentKind,
} from './chatRichText';
import {
  applyChatMention,
  canSendWith,
  chatMentionCandidates,
  mentionSegments,
  messageActions,
  parseChatMentions,
  quoteText,
  seenByLabel,
  seenByTooltip,
  sentAnnouncement,
  type ChatMessageActionId,
} from './chatThreadView';
import {
  DELETED_MESSAGE_TEXT,
  buildWindowItems,
  composerState,
  dismissPicker,
  isNearBottom,
  isSendKey,
  reactionPillLabel,
  togglePicker,
  typingLabel,
  windowSubtitle,
  windowTitle,
  type ComposerPicker,
  type ComposerPickerId,
} from './chatWindowView';
import { useChatKeyboardInset } from './useChatKeyboardInset';
import { useSharedBubbleGradient } from './useSharedBubbleGradient';
import './chat-thread.css';

/** Maksymalna wysokość auto-rosnącego pola treści (potem własny scroll). */
const COMPOSER_MAX_HEIGHT = 120;
/** Długie przytrzymanie dymka na dotyku otwiera menu wiadomości. */
const LONG_PRESS_MS = 400;
/** Ruch palca powyżej tego progu to przewijanie, nie przytrzymanie. */
const LONG_PRESS_SLOP_PX = 8;
/** Od tej wysokości dymka pasek reakcji staje przy przycisku, nie nad dymkiem. */
const TALL_BUBBLE_PX = 140;
/** Jak długo trwa podświetlenie wiadomości po skoku z cytatu albo przypiętych. */
const HIGHLIGHT_MS = 1600;
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** Pasek nad polem: odpowiedź, edycja albo potwierdzenie usunięcia. */
type ComposerMode =
  | { kind: 'none' }
  | { kind: 'reply'; messageId: string }
  | { kind: 'edit'; messageId: string; body: string }
  | { kind: 'delete'; messageId: string };

const NO_MODE: ComposerMode = { kind: 'none' };

function TextWithMentions({ text, directory }: { text: string; directory: ChatDirectory }) {
  return (
    <>
      {mentionSegments(text, directory).map((segment, index) =>
        segment.mention ? (
          <span key={index} className="n2chat-mention">
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Treść jednego dymka (GIF, „jumbo" emoji albo tekst z linkami i wzmiankami). */
function ChatMessageBody({
  body,
  kind,
  directory,
}: {
  body: string;
  kind: ChatContentKind;
  directory: ChatDirectory;
}) {
  if (kind === 'gif') {
    const url = body.trim();
    return (
      <>
        <ChatGifImage key={url} url={url} />
        {/* Atrybucja KLIPY wszędzie, gdzie widać ich treść (API Terms of Use). */}
        {gifAttribution(url) === 'klipy' && (
          <span className="n2chat-gif-credit">
            <img
              className="n2chat-gif-credit-mark"
              src="/klipy/klipy-watermark.svg"
              alt="Powered by KLIPY"
              width={44}
              height={15}
            />
          </span>
        )}
      </>
    );
  }
  if (kind === 'emoji') return <span className="n2chat-msg-text is-jumbo">{body.trim()}</span>;
  return (
    <span className="n2chat-msg-text">
      {tokenizeMessage(body).map((segment, index) =>
        segment.kind === 'link' ? (
          <a
            key={index}
            className="n2chat-link"
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {segment.label}
          </a>
        ) : (
          <TextWithMentions key={index} text={segment.text} directory={directory} />
        ),
      )}
    </span>
  );
}

export interface ChatThreadProps {
  conversation: ChatConversation;
  directory: ChatDirectory;
  /** `dock` = okno doku z nagłówkiem; `pane` = panel rozmowy w karcie zadania. */
  variant?: 'dock' | 'pane';
  /** Szkic tej rozmowy ('' = puste pole). */
  draft: string;
  onDraftChange: (value: string) => void;
  /** Powrót treści po NIEUDANEJ wysyłce (pole pustoszeje już przy Enterze). */
  onDraftRestore: (failed: string) => void;
  /** X w nagłówku doku: zamknięcie okna razem ze zdjęciem bąbelka. */
  onDismiss?: () => void;
  /** Podpowiedź w pustym polu. */
  placeholder?: string;
  /** Tekst pustej rozmowy. */
  emptyText?: string;
}

export function ChatThread({
  conversation,
  directory,
  variant = 'dock',
  draft,
  onDraftChange,
  onDraftRestore,
  onDismiss,
  placeholder = 'Napisz wiadomość…',
  emptyText = 'Brak wiadomości. Napisz pierwszą.',
}: ChatThreadProps) {
  const chat = useChat();
  const conversationId = conversation.id;
  const thread = chat.threads[conversationId] ?? EMPTY_THREAD;
  const messages = thread.messages;
  const isDock = variant === 'dock';
  const reduceMotion = useReducedMotion();

  const [mode, setMode] = useState<ComposerMode>(NO_MODE);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [mentionCaret, setMentionCaret] = useState(0);
  const [mentionActive, setMentionActive] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(true);
  const [picker, setPicker] = useState<ComposerPicker>('none');
  /** Ostatnio użyte emoji: pamięć sesji okna, celowo nie localStorage (D6). */
  const [recentEmoji, setRecentEmoji] = useState<readonly string[]>([]);
  const [reactionBarFor, setReactionBarFor] = useState<string | null>(null);
  const [reactionBarTall, setReactionBarTall] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const mentionListId = useId();
  const themeTriggerRef = useRef<HTMLButtonElement>(null);
  const reactTargetRef = useRef<string | null>(null);
  const reactTriggerRef = useRef<HTMLButtonElement | null>(null);
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  );
  const windowRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement>(null);
  const gifTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const stickRef = useRef(true);
  const caretRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const gifKey = useMemo(
    () => klipyApiKey(import.meta.env as unknown as Record<string, unknown>),
    [],
  );

  // Załączniki (L2): magazyn per sesja (zmiana tożsamości = nowy magazyn).
  const storage = useMemo(
    () => createAttachmentStorage(getSupabaseClient()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.selfId],
  );
  const queue = useAttachmentQueue(conversationId, storage.upload);

  useChatKeyboardInset(windowRef);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const editing = mode.kind === 'edit' ? mode : null;
  const composerValue = editing ? editing.body : draft;
  const setComposerValue = (value: string): void => {
    if (editing) setMode({ ...editing, body: value });
    else onDraftChange(value);
  };

  // ---- Model widoku -----------------------------------------------------------

  const theme = themeById(conversation.themeId);
  const themeVars = useMemo(() => themeCssVars(theme), [theme]);
  const quickReactions = useMemo(
    () =>
      [theme.quickReaction, ...CHAT_QUICK_REACTIONS.filter((e) => e !== theme.quickReaction)].slice(
        0,
        CHAT_QUICK_REACTIONS.length,
      ),
    [theme.quickReaction],
  );
  const title = windowTitle(conversation, chat.selfId, directory);
  const subtitle = windowSubtitle(conversation, chat.selfId, chat.presence);
  const online = isConversationOnline(conversation, chat.selfId, chat.presence);
  const today = todayStr();
  const items = useMemo(
    () =>
      buildWindowItems({
        messages,
        selfId: chat.selfId,
        directory,
        isGroup: conversation.kind !== 'direct',
        todayStr: today,
      }),
    [messages, chat.selfId, directory, conversation.kind, today],
  );
  const messageById = useMemo(() => new Map(messages.map((msg) => [msg.id, msg])), [messages]);
  const seen = useMemo(
    () => seenByMessage(messages, conversation.members, chat.selfId),
    [messages, conversation.members, chat.selfId],
  );
  const pins = useMemo(() => pinnedMessages(messages), [messages]);
  const typing = typingLabel(typingUserIds(thread.typing, Date.now()), directory);
  const canSend = editing
    ? editing.body.length <= CHAT_MESSAGE_MAX_LENGTH
    : canSendWith(draft, { ready: queue.attachments.length, allReady: queue.allReady });
  const limitHint = composerState(composerValue).hint;

  const mentionRange = mentionDismissed ? null : mentionQueryAt(composerValue, mentionCaret);
  const mentionOptions = mentionRange
    ? chatMentionCandidates(directory, mentionRange.query, chat.selfId)
    : [];
  const mentionIndex = Math.min(mentionActive, Math.max(0, mentionOptions.length - 1));

  // Nowa rozmowa => tryb, pickery i scroll od zera. Szkicu nie zerujemy.
  useEffect(() => {
    setMode(NO_MODE);
    setMentionDismissed(true);
    setPicker('none');
    setThemeOpen(false);
    setReactionBarFor(null);
    setPinsOpen(false);
    setActionError(null);
    reactTargetRef.current = null;
    stickRef.current = true;
  }, [conversationId]);

  useEffect(
    () => () => {
      if (longPressRef.current !== null) clearTimeout(longPressRef.current.timer);
    },
    [],
  );

  // Fokus wchodzi do kompozytora przy otwarciu okna doku. Panel zadania NIE
  // kradnie fokusu: otwarcie karty zaczyna się od jej szczegółów.
  useEffect(() => {
    if (isDock) composerRef.current?.focus();
  }, [conversationId, isDock]);

  // Dosunięcie do dołu PRZED malowaniem.
  useLayoutEffect(() => {
    const box = listRef.current;
    if (box === null || !stickRef.current) return;
    box.scrollTop = box.scrollHeight;
  }, [items]);

  useSharedBubbleGradient(listRef, [items, thread.reactions], !reduceMotion);

  const resizeComposer = (element: HTMLTextAreaElement): void => {
    element.style.height = 'auto';
    const frame = element.offsetHeight - element.clientHeight;
    const wanted = element.scrollHeight + frame;
    element.style.height = `${Math.min(wanted, COMPOSER_MAX_HEIGHT)}px`;
    element.style.overflowY = wanted > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden';
  };

  useLayoutEffect(() => {
    const element = composerRef.current;
    if (element !== null) resizeComposer(element);
  }, [conversationId, composerValue]);

  useLayoutEffect(() => {
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    const element = composerRef.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [composerValue]);

  // Podświetlenie po skoku gaśnie samo.
  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // ---- Skok do wiadomości (cytat, przypięte) --------------------------------------

  const focusMessage = useCallback(
    (id: string): boolean => {
      const row = listRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(id)}"]`,
      );
      if (!row) return false;
      stickRef.current = false;
      row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      row.focus({ preventScroll: true });
      setHighlightId(id);
      return true;
    },
    [reduceMotion],
  );

  const scrollToMessage = (id: string): void => {
    if (focusMessage(id)) return;
    if (thread.hasMore) {
      setPendingScrollId(id);
      setAnnouncement('Wczytuję starsze wiadomości.');
      chat.loadOlder(conversationId);
    } else {
      setAnnouncement('Tej wiadomości nie ma już w rozmowie.');
    }
  };

  // Cel skoku spoza wczytanej strony: dociągamy starsze, aż się pojawi.
  useEffect(() => {
    if (pendingScrollId === null || thread.loading) return;
    if (focusMessage(pendingScrollId)) {
      setPendingScrollId(null);
      return;
    }
    if (thread.hasMore) chat.loadOlder(conversationId);
    else {
      setPendingScrollId(null);
      setAnnouncement('Tej wiadomości nie ma już w rozmowie.');
    }
  }, [pendingScrollId, thread.loading, thread.hasMore, messages, focusMessage, chat, conversationId]);

  // ---- Pickery, emoji, wzmianki ------------------------------------------------

  const closePicker = (which: ComposerPickerId): void => {
    setPicker((current) => dismissPicker(current, which));
  };
  const flipPicker = (which: ComposerPickerId): void => {
    setPicker((current) => togglePicker(current, which));
  };

  const insertText = (text: string): void => {
    const element = composerRef.current;
    const start = element?.selectionStart ?? composerValue.length;
    const end = element?.selectionEnd ?? composerValue.length;
    const next = insertAtCaret(composerValue, start, end, text);
    if (next.value.length > CHAT_MESSAGE_MAX_LENGTH) return;
    caretRef.current = next.caret;
    setComposerValue(next.value);
    return;
  };

  const insertEmoji = (char: string): void => {
    insertText(char);
    setRecentEmoji((list) => pushRecentEmoji(list, char));
  };

  /** Przycisk „@”: wstawia znak i otwiera podpowiedzi przy kursorze. */
  const startMention = (): void => {
    const element = composerRef.current;
    const start = element?.selectionStart ?? composerValue.length;
    const before = composerValue.slice(0, start);
    const prefix = before === '' || /\s$/.test(before) ? '@' : ' @';
    insertText(prefix);
    setMentionCaret(start + prefix.length);
    setMentionDismissed(false);
    setMentionActive(0);
  };

  const insertMention = (person: ChatPerson): void => {
    if (!mentionRange) return;
    const next = applyChatMention(composerValue, mentionRange, person);
    caretRef.current = next.caret;
    setComposerValue(next.text);
    setMentionDismissed(true);
  };

  // ---- Reakcje -----------------------------------------------------------------

  const openReactionBar = (
    messageId: string,
    trigger: HTMLButtonElement | null,
    row: HTMLElement | null,
  ): void => {
    reactTriggerRef.current = trigger;
    setReactionBarTall((row?.offsetHeight ?? 0) > TALL_BUBBLE_PX);
    setReactionBarFor(messageId);
  };

  const pickReaction = (messageId: string, emoji: string): void => {
    chat.toggleReaction(conversationId, messageId, emoji);
    setReactionBarFor(null);
  };

  const openReactionPicker = (messageId: string): void => {
    reactTargetRef.current = messageId;
    setReactionBarFor(null);
    setPicker('react');
  };

  const pickReactionFromPicker = (char: string): void => {
    const target = reactTargetRef.current;
    reactTargetRef.current = null;
    setPicker('none');
    if (target !== null) chat.toggleReaction(conversationId, target, char);
    setRecentEmoji((list) => pushRecentEmoji(list, char));
  };

  // Długie przytrzymanie WYŁĄCZNIE na dotyku: mysz ma menu na hover, a
  // przytrzymanie lewego klawisza to zaznaczanie tekstu.
  const cancelLongPress = (): void => {
    if (longPressRef.current === null) return;
    clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };
  const startLongPress = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== 'touch') return;
    cancelLongPress();
    const row = event.currentTarget;
    longPressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        longPressRef.current = null;
        row.querySelector<HTMLButtonElement>('.n2chat-msg-more button')?.click();
      }, LONG_PRESS_MS),
    };
  };
  const moveLongPress = (event: ReactPointerEvent<HTMLElement>): void => {
    const pending = longPressRef.current;
    if (pending === null) return;
    if (
      Math.abs(event.clientX - pending.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(event.clientY - pending.y) > LONG_PRESS_SLOP_PX
    ) {
      cancelLongPress();
    }
  };

  // ---- Akcje wiadomości ------------------------------------------------------------

  const report = (result: { ok: true } | { ok: false; error: string }, success: string): boolean => {
    if (!mountedRef.current) return result.ok;
    if (result.ok) {
      setActionError(null);
      setAnnouncement(success);
      return true;
    }
    setActionError(result.error);
    return false;
  };

  const runAction = (messageId: string, action: ChatMessageActionId, row: HTMLElement | null): void => {
    const message = messageById.get(messageId);
    if (!message) return;
    setActionError(null);
    switch (action) {
      case 'reply':
        setMode({ kind: 'reply', messageId });
        composerRef.current?.focus();
        return;
      case 'react':
        openReactionBar(
          messageId,
          row?.querySelector<HTMLButtonElement>('.n2chat-react-btn') ?? null,
          row,
        );
        return;
      case 'pin': {
        const pinned = message.pinnedAt === null;
        void chat
          .setPin(conversationId, messageId, pinned)
          .then((result) => report(result, pinned ? 'Wiadomość przypięta.' : 'Wiadomość odpięta.'));
        return;
      }
      case 'edit':
        setMode({ kind: 'edit', messageId, body: message.body });
        setMentionDismissed(true);
        caretRef.current = message.body.length;
        return;
      case 'delete':
        setMode({ kind: 'delete', messageId });
        return;
    }
  };

  const confirmDelete = async (messageId: string): Promise<void> => {
    setBusy(true);
    const result = await chat.deleteMessage(conversationId, messageId);
    if (!mountedRef.current) return;
    setBusy(false);
    if (report(result, 'Wiadomość usunięta.')) setMode(NO_MODE);
    composerRef.current?.focus();
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing || busy) return;
    const original = messageById.get(editing.messageId);
    if (original && original.body === editing.body.trim()) {
      setMode(NO_MODE);
      return;
    }
    setBusy(true);
    const result = await chat.editMessage(conversationId, editing.messageId, editing.body);
    if (!mountedRef.current) return;
    setBusy(false);
    if (report(result, 'Wiadomość zmieniona.')) setMode(NO_MODE);
  };

  // ---- Wysyłka -------------------------------------------------------------------

  const sendGif = async (url: string): Promise<boolean> => {
    const result = await chat.sendMessage(conversationId, url);
    if (!result.ok) {
      if (mountedRef.current) setActionError(result.error);
      return false;
    }
    // Wynik `true` musi dojść do pickera także po zamknięciu okna (KLIPY share).
    if (mountedRef.current) {
      stickRef.current = true;
      setPicker('none');
      setAnnouncement('GIF wysłany.');
      composerRef.current?.focus();
    }
    return true;
  };

  const send = async (): Promise<void> => {
    if (editing) {
      await saveEdit();
      return;
    }
    if (!canSend || busy) return;
    const failed = draft;
    const body = replaceEmoticons(draft.trim());
    const attachments = queue.attachments;
    const replyTo = mode.kind === 'reply' ? mode.messageId : null;
    setBusy(true);
    onDraftChange('');
    const result = await chat.sendMessage(conversationId, body, {
      replyTo,
      attachments,
      mentionIds: parseChatMentions(body, directory, chat.selfId),
    });
    if (!result.ok) onDraftRestore(failed);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    // Kolejkę czyścimy DOPIERO po sukcesie (porażka zostawia obrazy do ponowienia).
    queue.clear();
    setActionError(null);
    setMode(NO_MODE);
    setAnnouncement(sentAnnouncement(attachments.length));
    stickRef.current = true;
    composerRef.current?.focus();
  };

  // ---- Upuszczanie obrazów na wątek ------------------------------------------------

  const hasFiles = (event: ReactDragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const dropHandlers = editing
    ? {}
    : {
        onDragEnter: (event: ReactDragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragging(true);
        },
        onDragOver: (event: ReactDragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: () => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragging(false);
        },
        onDrop: (event: ReactDragEvent) => {
          dragDepthRef.current = 0;
          setDragging(false);
          queue.onDrop(event);
        },
      };

  // ---- Render ---------------------------------------------------------------------

  const modeMessage = mode.kind === 'none' ? undefined : messageById.get(mode.messageId);
  const errorText = actionError ?? thread.error ?? (isDock ? chat.error : null);
  const firstLoad = thread.loading && messages.length === 0;
  const empty = !thread.loading && thread.loaded && messages.length === 0;

  return (
    <m.section
      ref={windowRef}
      className={`n2chat-thread is-${variant}${isDock ? ' n2chat-window' : ''}${
        reduceMotion ? ' has-static-gradient' : ''
      }`}
      style={themeVars}
      aria-label={isDock ? `Rozmowa: ${title}` : 'Komentarze do zadania'}
      initial={isDock ? { opacity: 0, y: reduceMotion ? 0 : 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      onKeyDown={(event) => {
        if (isDock && event.key === 'Escape' && !event.defaultPrevented) chat.closeConversation();
      }}
      {...dropHandlers}
    >
      <span role="status" aria-live="polite" className="n2chat-thread-live">
        {announcement}
      </span>
      {isDock && (
        <>
          <header className="n2chat-window-head">
            <ChatAvatar
              peerId={directPeerId(conversation, chat.selfId)}
              initials={conversationInitials(conversation, chat.selfId, directory)}
              directory={directory}
              size={32}
              isGroup={conversation.kind === 'group'}
            />
            <div className="n2chat-window-titles">
              <span className="n2chat-window-title">{title}</span>
              {subtitle !== '' && (
                <span className={`n2chat-window-status${online ? ' is-online' : ''}`}>{subtitle}</span>
              )}
            </div>
            <button
              ref={themeTriggerRef}
              type="button"
              className="n2chat-icon-btn"
              onClick={() => setThemeOpen((open) => !open)}
              aria-label="Motyw rozmowy"
              aria-haspopup="dialog"
              aria-expanded={themeOpen}
            >
              <Palette size={17} aria-hidden />
            </button>
            <button
              type="button"
              className="n2chat-icon-btn"
              onClick={() => chat.closeConversation()}
              aria-label="Minimalizuj rozmowę"
            >
              <ChevronDown size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="n2chat-icon-btn"
              onClick={onDismiss}
              aria-label="Zamknij rozmowę"
            >
              <X size={16} aria-hidden />
            </button>
          </header>
          <AnimatePresence>
            {themeOpen && (
              <ChatThemePicker
                key="themes"
                currentId={conversation.themeId}
                triggerRef={themeTriggerRef}
                onClose={() => setThemeOpen(false)}
                onPick={(picked) => {
                  setThemeOpen(false);
                  void chat.setTheme(conversationId, picked.id);
                }}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {pins.length > 0 && (
        <div className="n2chat-pins">
          <button
            type="button"
            className="n2chat-pins-toggle"
            aria-expanded={pinsOpen}
            onClick={() => setPinsOpen((open) => !open)}
          >
            <Pin size={14} aria-hidden />
            <span>Przypięte ({pins.length})</span>
            {!pinsOpen && <span className="n2chat-pins-peek">{quoteText(pins[0])}</span>}
            <ChevronDown size={14} aria-hidden className="n2chat-pins-chevron" />
          </button>
          {pinsOpen && (
            <ul className="n2chat-pins-list">
              {pins.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    className="n2chat-pins-item"
                    onClick={() => scrollToMessage(message.id)}
                  >
                    <span className="n2chat-pins-author">
                      {personFirstName(directory, message.authorId)}
                    </span>
                    <span className="n2chat-pins-text">{quoteText(message)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        className="n2chat-messages"
        ref={listRef}
        onScroll={() => {
          const box = listRef.current;
          if (box !== null) stickRef.current = isNearBottom(box);
        }}
      >
        {thread.hasMore && (
          <div className="n2chat-older">
            <button
              type="button"
              className="btn ghost n2chat-older-btn"
              onClick={() => chat.loadOlder(conversationId)}
              disabled={thread.loading}
            >
              {thread.loading ? 'Wczytywanie…' : 'Starsze wiadomości'}
            </button>
          </div>
        )}
        {firstLoad && <p className="n2chat-empty">Wczytywanie wiadomości…</p>}
        {empty && <p className="n2chat-empty">{emptyText}</p>}
        {items.map((item) =>
          item.kind === 'day' ? (
            <p key={item.key} className="n2chat-day">
              <span>{item.label}</span>
            </p>
          ) : item.kind === 'system' ? (
            <p key={item.key} className="n2chat-system">
              {item.text}
            </p>
          ) : (
            <div key={item.key} className={`n2chat-group${item.mine ? ' is-mine' : ''}`}>
              {item.showAuthor && <span className="n2chat-author">{item.authorName}</span>}
              {item.messages.map((view) => {
                const message = messageById.get(view.id);
                if (!message) return null;
                const quoted = message.replyTo ? messageById.get(message.replyTo) : undefined;
                const kind = view.deleted ? 'text' : messageContentKind(view.body);
                const reactions = thread.reactions[view.id] ?? [];
                const groups = view.deleted ? [] : groupReactions(reactions, chat.selfId);
                const barOpen = reactionBarFor === view.id;
                const actions = messageActions(message, chat.selfId);
                const readers = seen[view.id] ?? [];
                const hasBody = view.body.trim() !== '';
                return (
                  <div
                    key={view.id}
                    data-message-id={view.id}
                    tabIndex={-1}
                    className={`n2chat-msg${groups.length > 0 ? ' has-reactions' : ''}${
                      barOpen ? ' is-reacting' : ''
                    }${barOpen && reactionBarTall ? ' is-tall' : ''}${
                      highlightId === view.id ? ' is-highlighted' : ''
                    }`}
                    onPointerDown={view.deleted ? undefined : startLongPress}
                    onPointerMove={moveLongPress}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    onContextMenu={(event) => {
                      if (longPressRef.current !== null || barOpen) event.preventDefault();
                    }}
                  >
                    <div
                      className={`n2chat-bubble-msg${view.deleted ? ' is-deleted' : ''}${
                        kind === 'gif' ? ' is-gif' : ''
                      }${message.attachments.length > 0 && !view.deleted ? ' has-images' : ''}`}
                    >
                      {!view.deleted && message.replyTo && (
                        <button
                          type="button"
                          className="n2chat-quote"
                          onClick={() => scrollToMessage(message.replyTo!)}
                          aria-label={`Przejdź do cytowanej wiadomości: ${quoteText(quoted)}`}
                        >
                          {quoted && (
                            <span className="n2chat-quote-author">
                              {personFirstName(directory, quoted.authorId)}
                            </span>
                          )}
                          <span className="n2chat-quote-text">{quoteText(quoted)}</span>
                        </button>
                      )}
                      {view.deleted ? (
                        <span className="n2chat-msg-text">{DELETED_MESSAGE_TEXT}</span>
                      ) : (
                        <>
                          {message.attachments.length > 0 && (
                            <AttachmentGrid
                              attachments={message.attachments}
                              getSignedUrl={storage.getSignedUrl}
                            />
                          )}
                          {hasBody && (
                            <ChatMessageBody body={view.body} kind={kind} directory={directory} />
                          )}
                        </>
                      )}
                      <span className="n2chat-msg-time">
                        {message.pinnedAt !== null && !view.deleted && (
                          <Pin size={11} aria-label="Przypięta" className="n2chat-msg-pin" />
                        )}
                        {view.time}
                        {view.edited && ' (edytowana)'}
                      </span>
                    </div>
                    {actions.length > 0 && (
                      <span className="n2chat-msg-more">
                        <OverflowMenu
                          label="Akcje wiadomości"
                          size="sm"
                          items={actions.map((action) => ({
                            id: action.id,
                            label: action.label,
                            danger: action.danger,
                            onSelect: () =>
                              runAction(
                                view.id,
                                action.id,
                                listRef.current?.querySelector<HTMLElement>(
                                  `[data-message-id="${CSS.escape(view.id)}"]`,
                                ) ?? null,
                              ),
                          }))}
                        />
                      </span>
                    )}
                    {!view.deleted && (
                      <button
                        type="button"
                        className="n2chat-react-btn"
                        aria-label="Zareaguj na wiadomość"
                        aria-haspopup="true"
                        aria-expanded={barOpen}
                        onClick={(event) =>
                          barOpen
                            ? setReactionBarFor(null)
                            : openReactionBar(
                                view.id,
                                event.currentTarget,
                                event.currentTarget.parentElement,
                              )
                        }
                      >
                        <SmilePlus size={16} aria-hidden />
                      </button>
                    )}
                    <ReactionPills
                      groups={groups}
                      labelOf={(group) =>
                        reactionPillLabel(group, directory, chat.selfId, emojiLabel)
                      }
                      onToggle={(emoji) => chat.toggleReaction(conversationId, view.id, emoji)}
                    />
                    {readers.length > 0 && (
                      <div className="n2chat-seen" role="img" aria-label={seenByLabel(directory, readers)}>
                        {readers.map((reader) => (
                          <Tooltip
                            key={reader.userId}
                            text={seenByTooltip(directory, reader, today)}
                            visualOnly
                          >
                            <span className="n2chat-seen-avatar">
                              <ChatAvatar
                                peerId={reader.userId}
                                initials={personInitials(directory, reader.userId)}
                                directory={directory}
                                size={16}
                              />
                            </span>
                          </Tooltip>
                        ))}
                      </div>
                    )}
                    <AnimatePresence>
                      {barOpen && (
                        <ReactionBar
                          key="bar"
                          quick={quickReactions}
                          own={ownReaction(reactions, chat.selfId)}
                          triggerRef={reactTriggerRef}
                          onPick={(emoji) => pickReaction(view.id, emoji)}
                          onMore={() => openReactionPicker(view.id)}
                          onClose={() => setReactionBarFor(null)}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          ),
        )}
      </div>

      <div className="n2chat-composer">
        <AnimatePresence>
          {picker === 'emoji' && (
            <ChatEmojiPopover
              key="emoji"
              recent={recentEmoji}
              triggerRef={emojiTriggerRef}
              onClose={() => closePicker('emoji')}
              onPick={insertEmoji}
            />
          )}
          {picker === 'react' && (
            <ChatEmojiPopover
              key="react"
              label="Wybierz reakcję"
              recent={recentEmoji}
              triggerRef={emojiTriggerRef}
              onClose={() => closePicker('react')}
              onPick={pickReactionFromPicker}
            />
          )}
          {picker === 'gif' && gifKey !== '' && (
            <ChatGifPopover
              key="gif"
              apiKey={gifKey}
              customerId={chat.selfId ?? ''}
              triggerRef={gifTriggerRef}
              onClose={() => closePicker('gif')}
              onSend={sendGif}
            />
          )}
        </AnimatePresence>
        {typing !== '' && (
          <p className="n2chat-typing" aria-live="polite">
            {typing}
          </p>
        )}
        {errorText !== null && (
          <p role="alert" className="n2chat-error">
            {errorText}
          </p>
        )}

        {mode.kind === 'reply' && (
          <div className="n2chat-mode">
            <div className="n2chat-mode-text">
              <span className="n2chat-mode-title">
                Odpowiadasz {modeMessage ? personFirstName(directory, modeMessage.authorId) : ''}
              </span>
              <span className="n2chat-mode-quote">{quoteText(modeMessage)}</span>
            </div>
            <Tooltip text="Anuluj odpowiedź">
              <button
                type="button"
                className="n2chat-icon-btn n2chat-mode-close"
                aria-label="Anuluj odpowiedź"
                onClick={() => setMode(NO_MODE)}
              >
                <X size={16} aria-hidden />
              </button>
            </Tooltip>
          </div>
        )}
        {mode.kind === 'edit' && (
          <div className="n2chat-mode">
            <div className="n2chat-mode-text">
              <span className="n2chat-mode-title">Edytujesz wiadomość</span>
              <span className="n2chat-mode-quote">Enter zapisuje, Escape anuluje.</span>
            </div>
            <Tooltip text="Anuluj edycję">
              <button
                type="button"
                className="n2chat-icon-btn n2chat-mode-close"
                aria-label="Anuluj edycję"
                onClick={() => setMode(NO_MODE)}
              >
                <X size={16} aria-hidden />
              </button>
            </Tooltip>
          </div>
        )}
        {mode.kind === 'delete' && (
          <div className="n2chat-mode is-danger" role="group" aria-label="Usuwanie wiadomości">
            <div className="n2chat-mode-text">
              <span className="n2chat-mode-title">Usunąć tę wiadomość?</span>
              <span className="n2chat-mode-quote">{quoteText(modeMessage)}</span>
            </div>
            <button
              type="button"
              className="btn danger-ghost n2chat-mode-action"
              disabled={busy}
              onClick={() => void confirmDelete(mode.messageId)}
            >
              Usuń
            </button>
            <button
              type="button"
              className="btn ghost n2chat-mode-action"
              onClick={() => setMode(NO_MODE)}
            >
              Anuluj
            </button>
          </div>
        )}

        {mentionOptions.length > 0 && (
          <ul
            id={mentionListId}
            role="listbox"
            aria-label="Podpowiedzi wzmianek"
            className="n2chat-mentions"
          >
            {mentionOptions.map((person, index) => (
              <li
                key={person.id}
                id={`${mentionListId}-${index}`}
                role="option"
                aria-selected={index === mentionIndex}
                className="n2chat-mention-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(person)}
              >
                <ChatAvatar
                  peerId={person.id}
                  initials={personInitials(directory, person.id)}
                  directory={directory}
                  size={22}
                />
                <span>{`${person.firstName} ${person.lastName}`.trim()}</span>
              </li>
            ))}
          </ul>
        )}

        {!editing && (
          <AttachmentTray
            pending={queue.pending}
            error={queue.error}
            onRemove={queue.remove}
            onRetry={queue.retry}
          />
        )}

        <div className="n2chat-composer-row">
          <div className="n2chat-composer-tools">
            {!isDock && (
              <Tooltip text="Oznacz osobę">
                <button
                  type="button"
                  className="n2chat-icon-btn n2chat-composer-btn"
                  onClick={startMention}
                  aria-label="Oznacz osobę"
                >
                  <AtSign size={18} aria-hidden />
                </button>
              </Tooltip>
            )}
            <button
              ref={emojiTriggerRef}
              type="button"
              className="n2chat-icon-btn n2chat-composer-btn"
              onClick={() => flipPicker('emoji')}
              aria-label="Wybierz emoji"
              aria-haspopup="dialog"
              aria-expanded={picker === 'emoji'}
            >
              <Smile size={18} aria-hidden />
            </button>
            {gifKey !== '' && !editing && (
              <button
                ref={gifTriggerRef}
                type="button"
                className="n2chat-icon-btn n2chat-composer-btn"
                onClick={() => flipPicker('gif')}
                aria-label="Wybierz GIF"
                aria-haspopup="dialog"
                aria-expanded={picker === 'gif'}
              >
                <ImagePlay size={18} aria-hidden />
              </button>
            )}
            {!editing && (
              <Tooltip text="Dodaj obrazy (możesz też wkleić albo upuścić)">
                <button
                  type="button"
                  className="n2chat-icon-btn n2chat-composer-btn"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Dodaj obrazy"
                >
                  <ImagePlus size={18} aria-hidden />
                </button>
              </Tooltip>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={IMAGE_ACCEPT}
              className="n2chat-file-input"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                if (event.target.files) queue.addFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
          <textarea
            ref={composerRef}
            className="n2chat-input"
            rows={1}
            value={composerValue}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            placeholder={editing ? 'Treść wiadomości' : placeholder}
            aria-label={editing ? 'Edytuj wiadomość' : 'Treść wiadomości'}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={mentionOptions.length > 0}
            aria-controls={mentionOptions.length > 0 ? mentionListId : undefined}
            aria-activedescendant={
              mentionOptions.length > 0 ? `${mentionListId}-${mentionIndex}` : undefined
            }
            enterKeyHint={editing ? 'done' : 'send'}
            onSelect={(event) => setMentionCaret(event.currentTarget.selectionStart)}
            onPaste={editing ? undefined : queue.onPaste}
            onChange={(event) => {
              setMentionCaret(event.target.selectionStart);
              setMentionDismissed(false);
              setMentionActive(0);
              setComposerValue(event.target.value);
              if (!editing) chat.sendTyping(conversationId);
            }}
            onKeyDown={(event) => {
              if (mentionOptions.length > 0) {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setMentionDismissed(true);
                  return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setMentionActive(
                    (mentionIndex + step + mentionOptions.length) % mentionOptions.length,
                  );
                  return;
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  insertMention(mentionOptions[mentionIndex]);
                  return;
                }
              }
              if (event.key === 'Escape' && mode.kind !== 'none') {
                // Escape najpierw zamyka tryb (odpowiedź, edycja), dopiero potem okno.
                event.preventDefault();
                event.stopPropagation();
                setMode(NO_MODE);
                return;
              }
              if (!isSendKey(event)) return;
              event.preventDefault();
              void send();
            }}
          />
          {!isDock && <span className="n2chat-enter-hint" aria-hidden="true">Enter wysyła</span>}
          <button
            type="button"
            className="n2chat-send"
            onClick={() => void send()}
            disabled={!canSend || busy}
            aria-label={editing ? 'Zapisz zmianę' : 'Wyślij wiadomość'}
          >
            <Send size={16} aria-hidden />
          </button>
        </div>
        {limitHint !== '' && <p className="n2chat-error">{limitHint}</p>}
      </div>
      <DropZoneOverlay active={dragging} />
    </m.section>
  );
}
