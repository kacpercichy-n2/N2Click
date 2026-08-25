// Okno rozmowy zakotwiczone na lewo od kolumny bąbelków. Cienki komponent:
// grupowanie wiadomości, etykiety i stan kompozytora liczy `chatWindowView.ts`.
//
// DECYZJE:
//   * JEDNO okno naraz (kontrakt rdzenia: `openConversationId` jest pojedyncze).
//   * `markRead()` NIE jest tu wołane — robi to `ChatProvider` po wczytaniu
//     pierwszej strony i przy każdej cudzej wiadomości w otwartej rozmowie.
//     Dublowanie tylko mnożyłoby zapisy.
//   * To NIE jest modal: bez pułapki fokusa, bez blokady scrolla, bez `inert`.
//     Fokus wchodzi do kompozytora, Escape zamyka okno, gdy fokus jest w środku.
//   * Dosuwanie scrolla działa tylko wtedy, gdy użytkownik JEST przy dole —
//     czytanie starszych wiadomości nie może być przerywane skokiem.
//   * MINIMALIZACJA = ZAMKNIĘCIE OKNA (decyzja D1): okno nie ma stanu
//     „zwinięte". Nagłówek jest informacyjny (tytuł + status to zwykły blok,
//     nie przycisk) i ma DWA przyciski: chevron „Minimalizuj" (i Escape)
//     odmontowuje okno, a bąbelek zostaje w kolumnie doku jako kotwica; X
//     „Zamknij" dodatkowo zdejmuje bąbelek z kolumny (`onDismiss` w doku) —
//     rozmowa wraca do listy w popoverze, a bąbelek wróci sam przy nowej
//     nieprzeczytanej wiadomości.
//   * TREŚĆ DYMKA idzie przez czysty `chatRichText.ts` (decyzje D4/D5a/D7):
//     linki jako DANE (nigdy `dangerouslySetInnerHTML`), sam adres GIF-a jako
//     `<img>`, 1–3 emoji większym stopniem, nowe linie zachowane w CSS.
//   * Oba pickery (emoji, GIF) są dziećmi kompozytora — jeden naraz, bo dzielą
//     to samo miejsce nad nim.
//   * REAKCJE (model Messengera, jedna na osobę): desktop pokazuje przy dymku
//     przycisk „Zareaguj" na hover/fokus, dotyk otwiera pasek DŁUGIM
//     PRZYTRZYMANIEM dymka (400 ms, anulowane ruchem > 8 px). „+” w pasku
//     otwiera ten sam `ChatEmojiPopover` w slocie kompozytora w trybie
//     „wybierz jedno" (`picker === 'react'`, cel w `reactTargetRef`). Pigułki
//     pod dymkiem to toggle własnej reakcji tym emoji. Stan i zapis niesie
//     `ChatProvider.toggleReaction` (optymistycznie + RPC).
//   * MOTYW ROZMOWY (skiny): katalog `themes/catalog.ts` → zmienne CSS na
//     korzeniu okna (`themeCssVars`), nigdy globalnie. Picker pod nagłówkiem
//     (`ChatThemePicker`), zapis przez `chat.setTheme`. Wiersz systemowy
//     „X ustawia motyw »Y«" przychodzi jako `kind: 'system'` i renderuje się
//     jako jedna wyśrodkowana linia. Moje dymki dzielą JEDEN gradient płynący
//     ze scrollem (`useSharedBubbleGradient`); przy `prefers-reduced-motion`
//     gradient jest statyczny per dymek.
//   * SZKIC JEST WŁASNOŚCIĄ DOKU (`draft` / `onDraftChange`). Skoro
//     minimalizacja odmontowuje okno, stan lokalny gubiłby wpisany tekst —
//     `ChatDock` trzyma szkice per rozmowa i oddaje je przy ponownym otwarciu.
//     Enter pustoszy pole NATYCHMIAST, a nieudana wysyłka oddaje treść przez
//     `onDraftRestore`. Odwrotna kolejność (kasowanie po odpowiedzi) zmuszałaby
//     do zgadywania po treści, co w polu należy do wysyłki — a odpowiedź wraca
//     i po zamknięciu okna, i po dopisaniu kolejnych słów.
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import {
  ChevronDown,
  ImagePlay,
  Palette,
  Send,
  Smile,
  SmilePlus,
  X,
} from '../../components/icons';
import { todayStr } from '../../utils/dates';
import { useChat } from '../ChatProvider';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_QUICK_REACTIONS, type ChatConversation } from '../types';
import { ChatAvatar } from './ChatAvatar';
import { ChatEmojiPopover } from './ChatEmojiPopover';
import { ChatGifPopover } from './ChatGifPopover';
import { ReactionBar, ReactionPills } from './ChatReactions';
import { ChatThemePicker } from './ChatThemePicker';
import { emojiLabel, insertAtCaret, pushRecentEmoji, replaceEmoticons } from './chatEmoji';
import { groupReactions, ownReaction } from '../chatState';
import { themeById } from '../themes/catalog';
import { themeCssVars } from '../themes/themeVars';
import { useSharedBubbleGradient } from './useSharedBubbleGradient';
import { klipyApiKey } from './chatGifs';
import {
  conversationInitials,
  directPeerId,
  isConversationOnline,
  type ChatDirectory,
} from './chatPeople';
import {
  gifAttribution,
  messageContentKind,
  tokenizeMessage,
  type ChatContentKind,
} from './chatRichText';
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

/** Maksymalna wysokość auto-rosnącego pola treści (potem własny scroll). */
const COMPOSER_MAX_HEIGHT = 120;

/** Długie przytrzymanie dymka na dotyku otwiera pasek reakcji. */
const LONG_PRESS_MS = 400;
/** Ruch palca powyżej tego progu to przewijanie, nie przytrzymanie. */
const LONG_PRESS_SLOP_PX = 8;
/** Od tej wysokości dymka pasek reakcji staje przy przycisku, nie nad dymkiem. */
const TALL_BUBBLE_PX = 140;

/**
 * Treść jednego dymka. GIF i „jumbo" emoji rozpoznaje `messageContentKind`,
 * reszta jedzie segmentami z tokenizera — link zawsze jako `<a>` z
 * `rel="noopener noreferrer"`, nigdy jako wstrzyknięty HTML.
 */
function ChatMessageBody({ body, kind }: { body: string; kind: ChatContentKind }) {
  if (kind === 'gif') {
    const url = body.trim();
    return (
      <>
        <a className="n2chat-gif-link" href={url} target="_blank" rel="noopener noreferrer">
          <img className="n2chat-gif" src={url} loading="lazy" alt="GIF" />
        </a>
        {/* Atrybucja dostawcy przy UDOSTĘPNIONYM wyniku: „API Terms of Use"
            KLIPY każe pokazać znak WSZĘDZIE, gdzie widać ich treść, nie tylko
            w pickerze. Formuła zostaje po angielsku — tak brzmi wymagana. */}
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
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </span>
  );
}

export function ChatWindow({
  conversation,
  directory,
  draft,
  onDraftChange,
  onDraftRestore,
  onDismiss,
}: {
  conversation: ChatConversation;
  directory: ChatDirectory;
  /** Szkic tej rozmowy z pamięci sesji doku ('' = puste pole). */
  draft: string;
  /** Zapis szkicu w doku ('' kasuje wpis rozmowy). */
  onDraftChange: (value: string) => void;
  /** Powrót treści po NIEUDANEJ wysyłce (pole pustoszeje już przy Enterze). */
  onDraftRestore: (failed: string) => void;
  /** X w nagłówku: zamknięcie okna RAZEM ze zdjęciem bąbelka z kolumny doku. */
  onDismiss: () => void;
}) {
  const chat = useChat();
  const reduceMotion = useReducedMotion();
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<ComposerPicker>('none');
  /** Ostatnio użyte emoji — PAMIĘĆ SESJI okna, celowo nie localStorage (D6). */
  const [recentEmoji, setRecentEmoji] = useState<readonly string[]>([]);
  /** Id wiadomości z otwartym paskiem reakcji; null = żaden. */
  const [reactionBarFor, setReactionBarFor] = useState<string | null>(null);
  /** Dymek z otwartym paskiem jest wysoki: pasek staje przy przycisku, nie nad dymkiem. */
  const [reactionBarTall, setReactionBarTall] = useState(false);
  /** Otwarty picker motywu pod nagłówkiem. */
  const [themeOpen, setThemeOpen] = useState(false);
  const themeTriggerRef = useRef<HTMLButtonElement>(null);
  /** Cel pełnego pickera w trybie reakcji (`picker === 'react'`). */
  const reactTargetRef = useRef<string | null>(null);
  /** Przycisk „Zareaguj", który otworzył pasek (powrót fokusa po zamknięciu). */
  const reactTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** Trwające długie przytrzymanie na dotyku (timer + punkt startu). */
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  );
  const windowRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement>(null);
  const gifTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  /** Czy lista była przy dole PRZED dojściem nowej wiadomości. */
  const stickRef = useRef(true);
  /** Karetka do przywrócenia po wstawieniu emoji (`null` = nic nie czeka). */
  const caretRef = useRef<number | null>(null);
  /** Klucz KLIPY czytamy RAZ — brak klucza chowa przycisk GIF (D5b). */
  const gifKey = useMemo(
    () => klipyApiKey(import.meta.env as unknown as Record<string, unknown>),
    [],
  );

  // Obie decyzje o panelach są CZYSTE (`chatWindowView.ts`): klik w przycisk
  // przełącza, a sygnał zamknięcia z powłoki jest ADRESOWANY — spóźniony sygnał
  // od panelu, który już wychodzi, nie może zgasić świeżo otwartego sąsiada.
  const closePicker = (which: ComposerPickerId): void => {
    setPicker((current) => dismissPicker(current, which));
  };
  const flipPicker = (which: ComposerPickerId): void => {
    setPicker((current) => togglePicker(current, which));
  };

  // Klawiatura ekranowa telefonu: okno podnosi się i skraca, żeby kompozytor
  // nie schował się pod nią. Na desktopie hook nie robi nic.
  useChatKeyboardInset(windowRef);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const theme = themeById(conversation.themeId);
  const themeVars = useMemo(() => themeCssVars(theme), [theme]);
  /** Pasek reakcji: emoji motywu pierwsze, reszta domyślna (7 pozycji). */
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
  const items = useMemo(
    () =>
      buildWindowItems({
        messages: chat.messages,
        selfId: chat.selfId,
        directory,
        isGroup: conversation.kind === 'group',
        todayStr: todayStr(),
      }),
    [chat.messages, chat.selfId, directory, conversation.kind],
  );
  const typing = typingLabel(chat.typingUserIds, directory);
  const composer = composerState(draft);

  // Nowa rozmowa => otwarty picker i pozycja scrolla zaczynają od zera. Szkicu
  // NIE zerujemy: należy do doku i jest już wybrany po rozmowie.
  useEffect(() => {
    setPicker('none');
    setThemeOpen(false);
    setReactionBarFor(null);
    reactTargetRef.current = null;
    stickRef.current = true;
  }, [conversation.id]);

  // Sprzątanie timera długiego przytrzymania przy odmontowaniu okna.
  useEffect(
    () => () => {
      if (longPressRef.current !== null) clearTimeout(longPressRef.current.timer);
    },
    [],
  );

  // Fokus wchodzi do kompozytora przy otwarciu okna.
  useEffect(() => {
    composerRef.current?.focus();
  }, [conversation.id]);

  // Dosunięcie do dołu PRZED malowaniem — bez migotania listy.
  useLayoutEffect(() => {
    const box = listRef.current;
    if (box === null || !stickRef.current) return;
    box.scrollTop = box.scrollHeight;
  }, [items]);

  // Wspólny gradient moich dymków płynący ze scrollem; pomiar po każdej zmianie
  // listy i reakcji (pigułki zmieniają wysokość wierszy).
  useSharedBubbleGradient(listRef, [items, chat.reactions], !reduceMotion);

  // Wysokość = treść + obramowanie. Pole ma `box-sizing: border-box`, więc
  // sam `scrollHeight` (bez 2 px ramki) dawał treść o 2 px wyższą od okna
  // widocznego i pusty pasek przewijania w jednowierszowym polu. Własny scroll
  // pole dostaje dopiero po dobiciu do maksimum.
  const resizeComposer = (element: HTMLTextAreaElement): void => {
    element.style.height = 'auto';
    const frame = element.offsetHeight - element.clientHeight;
    const wanted = element.scrollHeight + frame;
    element.style.height = `${Math.min(wanted, COMPOSER_MAX_HEIGHT)}px`;
    element.style.overflowY = wanted > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden';
  };

  // Wysokość pola nadąża za KAŻDĄ zmianą szkicu, bo szkic nie zmienia się już
  // tylko od pisania: wraca z doku przy ponownym otwarciu rozmowy (`rows={1}`
  // dałoby jeden wiersz i ucięcie tekstu do własnego scrolla), wchodzi w niego
  // emoji, a udana wysyłka zwija pole z powrotem. Efekt UKŁADU, więc wysokość
  // jest gotowa przed malowaniem, a jedno miejsce liczy ją dla wszystkich dróg.
  useLayoutEffect(() => {
    const element = composerRef.current;
    if (element !== null) resizeComposer(element);
  }, [conversation.id, draft]);

  // Karetka po wstawieniu emoji. Ustawiamy ją PO renderze z nową treścią —
  // wcześniej pole ma jeszcze starą wartość i `setSelectionRange` trafiłby w
  // nieistniejącą pozycję.
  useLayoutEffect(() => {
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    const element = composerRef.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [draft]);

  /** Emoji z pickera wchodzi w pozycję kursora; panel zostaje otwarty. */
  const insertEmoji = (char: string): void => {
    const element = composerRef.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    const next = insertAtCaret(draft, start, end, char);
    if (next.value.length > CHAT_MESSAGE_MAX_LENGTH) return;
    caretRef.current = next.caret;
    onDraftChange(next.value);
    setRecentEmoji((list) => pushRecentEmoji(list, char));
  };

  // ---- Reakcje ---------------------------------------------------------------

  const openReactionBar = (
    messageId: string,
    trigger: HTMLButtonElement | null,
    row: HTMLElement | null,
  ): void => {
    reactTriggerRef.current = trigger;
    setReactionBarTall((row?.offsetHeight ?? 0) > TALL_BUBBLE_PX);
    setReactionBarFor(messageId);
  };

  /** Emoji z paska: zapis + zamknięcie paska (jedna reakcja, nie seria). */
  const pickReaction = (messageId: string, emoji: string): void => {
    chat.toggleReaction(messageId, emoji);
    setReactionBarFor(null);
  };

  /** „+” w pasku: pełny picker w slocie kompozytora, w trybie „wybierz jedno". */
  const openReactionPicker = (messageId: string): void => {
    reactTargetRef.current = messageId;
    setReactionBarFor(null);
    setPicker('react');
  };

  const pickReactionFromPicker = (char: string): void => {
    const target = reactTargetRef.current;
    reactTargetRef.current = null;
    setPicker('none');
    if (target !== null) chat.toggleReaction(target, char);
    setRecentEmoji((list) => pushRecentEmoji(list, char));
  };

  // Długie przytrzymanie WYŁĄCZNIE na dotyku: mysz ma przycisk „Zareaguj" na
  // hover, a przytrzymanie lewego klawisza to zaznaczanie tekstu.
  const startLongPress = (event: ReactPointerEvent<HTMLElement>, messageId: string): void => {
    if (event.pointerType !== 'touch') return;
    cancelLongPress();
    const row = event.currentTarget;
    longPressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        longPressRef.current = null;
        openReactionBar(messageId, null, row);
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
  const cancelLongPress = (): void => {
    if (longPressRef.current === null) return;
    clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };

  /** Wysłanie GIF-a: adres jest CAŁĄ treścią wiadomości, szkic zostaje nietknięty. */
  const sendGif = async (url: string): Promise<boolean> => {
    const ok = await chat.sendMessage(url);
    if (!ok) return false;
    // Odmontowanie wyłącza wyłącznie aktualizacje UI. Wynik `true` musi dojść
    // do pickera także po zamknięciu okna, żeby udana wysyłka nadal zgłosiła
    // KLIPY `gifs/share` (callback pickera żyje do końca Promise).
    if (mountedRef.current) {
      stickRef.current = true;
      setPicker('none');
      composerRef.current?.focus();
    }
    return true;
  };

  const send = async (): Promise<void> => {
    if (!composer.canSend || sending) return;
    // Pole pustoszeje OD RAZU, a nie po odpowiedzi serwera. To jedyny wariant,
    // w którym późniejsze sprzątanie nie musi zgadywać, co w polu jest tekstem
    // tej wysyłki, a co dopisał użytkownik: wszystko, co pojawi się od tej
    // chwili, jest już jego. Zapisujemy SUROWĄ treść (nie przyciętą
    // `composer.value`), żeby porażka oddała dokładnie to, co było widać.
    const failed = draft;
    setSending(true);
    onDraftChange('');
    // Tekstowe emotikony („<3", „:)") wychodzą jako emoji — zamiana siedzi na
    // granicy wysyłki, więc baza i odbiorca dostają już prawdziwy znak.
    const ok = await chat.sendMessage(replaceEmoticons(composer.value));
    // Porażka: treść wraca do doku niezależnie od tego, czy okno jeszcze żyje —
    // `ChatProvider` trzyma po odmowie sam komunikat, nie tekst wiadomości.
    if (!ok) onDraftRestore(failed);
    if (!mountedRef.current) return;
    setSending(false);
    if (!ok) return;
    stickRef.current = true;
    composerRef.current?.focus();
  };

  return (
    <m.section
      ref={windowRef}
      className={`n2chat-window${reduceMotion ? ' has-static-gradient' : ''}`}
      style={themeVars}
      aria-label={`Rozmowa: ${title}`}
      initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') chat.closeConversation();
      }}
    >
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
          title="Motyw"
        >
          <Palette size={17} aria-hidden />
        </button>
        <button
          type="button"
          className="n2chat-icon-btn"
          onClick={() => chat.closeConversation()}
          aria-label="Minimalizuj rozmowę"
          title="Minimalizuj"
        >
          <ChevronDown size={18} aria-hidden />
        </button>
        <button
          type="button"
          className="n2chat-icon-btn"
          onClick={onDismiss}
          aria-label="Zamknij rozmowę"
          title="Zamknij"
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
              void chat.setTheme(picked.id);
            }}
          />
        )}
      </AnimatePresence>

      <div
        className="n2chat-messages"
        ref={listRef}
        onScroll={() => {
          const box = listRef.current;
          if (box !== null) stickRef.current = isNearBottom(box);
        }}
      >
        {chat.hasMore && (
          <div className="n2chat-older">
            <button
              type="button"
              className="btn ghost n2chat-older-btn"
              onClick={() => chat.loadOlder()}
              disabled={chat.messagesLoading}
            >
              {chat.messagesLoading ? 'Wczytywanie…' : 'Starsze wiadomości'}
            </button>
          </div>
        )}
        {chat.messagesLoading && chat.messages.length === 0 && (
          <p className="n2chat-empty">Wczytywanie wiadomości…</p>
        )}
        {!chat.messagesLoading && chat.messages.length === 0 && (
          <p className="n2chat-empty">Brak wiadomości. Napisz pierwszą.</p>
        )}
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
              {item.messages.map((message) => {
                const kind = message.deleted ? 'text' : messageContentKind(message.body);
                const reactions = chat.reactions[message.id] ?? [];
                const groups = message.deleted ? [] : groupReactions(reactions, chat.selfId);
                const barOpen = reactionBarFor === message.id;
                return (
                  <div
                    key={message.id}
                    className={`n2chat-msg${groups.length > 0 ? ' has-reactions' : ''}${
                      barOpen ? ' is-reacting' : ''
                    }${barOpen && reactionBarTall ? ' is-tall' : ''}`}
                    onPointerDown={
                      message.deleted ? undefined : (event) => startLongPress(event, message.id)
                    }
                    onPointerMove={moveLongPress}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    onContextMenu={(event) => {
                      // Menu kontekstowe dotyku wyskakuje w trakcie przytrzymania
                      // i zabiłoby pasek; mysz (prawy klik) zostaje bez zmian.
                      if (longPressRef.current !== null || barOpen) event.preventDefault();
                    }}
                  >
                    <p
                      className={`n2chat-bubble-msg${message.deleted ? ' is-deleted' : ''}${
                        kind === 'gif' ? ' is-gif' : ''
                      }`}
                    >
                      {message.deleted ? (
                        <span className="n2chat-msg-text">{DELETED_MESSAGE_TEXT}</span>
                      ) : (
                        <ChatMessageBody body={message.body} kind={kind} />
                      )}
                      <span className="n2chat-msg-time">
                        {message.time}
                        {message.edited && ' (edytowana)'}
                      </span>
                    </p>
                    {!message.deleted && (
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
                                message.id,
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
                      onToggle={(emoji) => chat.toggleReaction(message.id, emoji)}
                    />
                    <AnimatePresence>
                      {barOpen && (
                        <ReactionBar
                          key="bar"
                          quick={quickReactions}
                          own={ownReaction(reactions, chat.selfId)}
                          triggerRef={reactTriggerRef}
                          onPick={(emoji) => pickReaction(message.id, emoji)}
                          onMore={() => openReactionPicker(message.id)}
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
              // KLIPY wymaga STABILNEGO identyfikatora użytkownika w zapytaniu
              // i w zgłoszeniu udostępnienia. Chmurowe `selfId` jest dokładnie
              // takie: nieprzezroczyste uuid, to samo przez całą sesję.
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
        {chat.error !== null && <p className="n2chat-error">{chat.error}</p>}
        <div className="n2chat-composer-row">
          {/* Emoji i GIF stoją obok siebie BEZ odstępu w jednej grupie — dwa
              osobne przyciski z pełnym `gap` wiersza odbierały polu treści
              blisko 20 px na oknie 380 px. */}
          <div className="n2chat-composer-tools">
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
            {gifKey !== '' && (
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
          </div>
          <textarea
            ref={composerRef}
            className="n2chat-input"
            rows={1}
            value={draft}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            placeholder="Napisz wiadomość…"
            aria-label="Treść wiadomości"
            // Enter WYSYŁA (`isSendKey`), więc klawiatura telefonu ma pokazać
            // „Wyślij" zamiast domyślnego łamania wiersza.
            enterKeyHint="send"
            onChange={(event) => {
              onDraftChange(event.target.value);
              chat.sendTyping();
            }}
            onKeyDown={(event) => {
              if (!isSendKey(event)) return;
              event.preventDefault();
              void send();
            }}
          />
          <button
            type="button"
            className="n2chat-send"
            onClick={() => void send()}
            disabled={!composer.canSend || sending}
            aria-label="Wyślij wiadomość"
          >
            <Send size={16} aria-hidden />
          </button>
        </div>
        {composer.hint !== '' && <p className="n2chat-error">{composer.hint}</p>}
      </div>
    </m.section>
  );
}
