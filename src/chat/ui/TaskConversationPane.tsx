// Prawa kolumna karty zadania (karta v2): „Rozmowa”. Linia L4 montuje ten
// komponent w karcie; on wypełnia wysokość kontenera i przewija się w środku.
//
// TRYBY:
//   * Chmura: rozmowa zadania z silnika czatu (`chat_open_task`). Nagłówek
//     „Rozmowa”, zakładki „Komentarze (n)” / „Historia (n)”, awatary
//     obserwujących i dzwonek (Obserwuj / Przestań obserwować), potem
//     `ChatThread` w wariancie `pane`. Panel trzyma wątek przy życiu
//     (`attachConversation`), więc dok może w tym czasie pokazywać inną rozmowę.
//   * Lokalnie (`VITE_AUTH_MODE=local`): stary `CommentsPanel` (komentarze
//     i historia zmian z reduktora). Silnik czatu działa tylko w chmurze.
//
// Historia to dziennik aktywności zadania z istniejącego selektora
// (`activityFor`), tylko do odczytu.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
// Ikony spoza kuratorowanego `components/icons.ts` (plik wspólny, poza L3).
import { Bell, BellOff } from 'lucide-react';
import { CommentsPanel } from '../../components/CommentsPanel';
import { Tooltip } from '../../components/Tooltip';
import { useStore } from '../../store/AppStore';
import { activityFor, getPerson, taskConversationNotificationId } from '../../store/selectors';
import { useOrgData } from '../../supabase/OrgDataProvider';
import { formatTimestamp } from '../../utils/dates';
import { useChat } from '../ChatProvider';
import { EMPTY_THREAD, findTaskConversation, followerIds, isFollowing } from '../chatState';
import { ChatAvatar } from './ChatAvatar';
import { ChatThread } from './ChatThread';
import { buildDirectory, personInitials, personLabel, type ChatPerson } from './chatPeople';
import { commentCountLabel } from './chatThreadView';
import {
  followersSummary,
  isCloudTaskId,
  unreadTaskConversationNotifications,
  visibleFollowers,
} from './taskConversationView';
import './chat-thread.css';

export interface TaskConversationPaneProps {
  taskId: string;
}

const NO_PEOPLE: ChatPerson[] = [];

export function TaskConversationPane({ taskId }: TaskConversationPaneProps) {
  const chat = useChat();
  return (
    <section className="n2chat-task-pane" aria-labelledby={`n2chat-task-title-${taskId}`}>
      {chat.enabled ? (
        <CloudTaskConversation key={taskId} taskId={taskId} />
      ) : (
        <>
          <h2 id={`n2chat-task-title-${taskId}`} className="n2chat-visually-hidden">
            Rozmowa
          </h2>
          <div className="n2chat-task-local">
            <CommentsPanel entityType="task" entityId={taskId} />
          </div>
        </>
      )}
    </section>
  );
}

type PaneTab = 'comments' | 'history';
type OpenState =
  | { status: 'opening' }
  | { status: 'ready'; conversationId: string }
  | { status: 'failed'; error: string }
  | { status: 'forbidden'; error: string }
  | { status: 'unsaved' };

function CloudTaskConversation({ taskId }: TaskConversationPaneProps) {
  const chat = useChat();
  const { state, dispatch } = useStore();
  const org = useOrgData();
  const [open, setOpen] = useState<OpenState>(() =>
    isCloudTaskId(taskId) ? { status: 'opening' } : { status: 'unsaved' },
  );
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<PaneTab>('comments');
  const [draft, setDraft] = useState('');
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const tabRefs = useRef<Record<PaneTab, HTMLButtonElement | null>>({ comments: null, history: null });

  const people = useMemo<ChatPerson[]>(
    () =>
      org.state.status === 'ready'
        ? org.state.snapshot.profiles.map((profile) => ({
            id: profile.id,
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
          }))
        : NO_PEOPLE,
    [org.state],
  );
  const directory = useMemo(() => buildDirectory(people), [people]);
  const activity = useMemo(
    () => [...activityFor(state, 'task', taskId)].reverse(),
    [state, taskId],
  );

  const { openTaskConversation, attachConversation } = chat;
  useEffect(() => {
    if (!isCloudTaskId(taskId)) {
      setOpen({ status: 'unsaved' });
      return;
    }
    let cancelled = false;
    setOpen({ status: 'opening' });
    void openTaskConversation(taskId).then((result) => {
      if (cancelled) return;
      if (result.ok) setOpen({ status: 'ready', conversationId: result.conversationId });
      // Brak wglądu w zadanie: stan końcowy, bez przycisku ponowienia.
      else if (result.forbidden) setOpen({ status: 'forbidden', error: result.error });
      else setOpen({ status: 'failed', error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, openTaskConversation, attempt]);

  const conversationId = open.status === 'ready' ? open.conversationId : null;
  // Wątek żyje, dopóki panel jest zamontowany (dok może pokazywać coś innego).
  useEffect(() => {
    if (conversationId === null) return;
    return attachConversation(conversationId);
  }, [conversationId, attachConversation]);

  const conversation =
    (conversationId !== null ? chat.conversations.find((c) => c.id === conversationId) : null) ??
    findTaskConversation(chat.conversations, taskId);
  const thread = conversation ? chat.threads[conversation.id] ?? EMPTY_THREAD : EMPTY_THREAD;
  const selfMember = conversation?.members.find((m) => m.userId === chat.selfId);
  const following = isFollowing(selfMember);
  const followers = conversation ? followerIds(conversation) : [];
  const shown = visibleFollowers(followers, 4);
  const commentCount = thread.loaded ? commentCountLabel(thread.messages, thread.hasMore) : null;
  const titleId = `n2chat-task-title-${taskId}`;
  const panelId = `n2chat-task-panel-${taskId}`;

  // Oglądana rozmowa gasi powiadomienia tego zadania (dzwonek, kafel Panelu).
  // Każdy wpis wysyłamy najwyżej raz na montaż; reduktor i tak pomija przeczytane.
  const markedRef = useRef<Set<string>>(new Set());
  const notificationsRef = useRef(state.notifications);
  notificationsRef.current = state.notifications;
  const currentUserId = state.currentUserId;
  const markNotificationsRead = useCallback((): void => {
    for (const id of unreadTaskConversationNotifications(notificationsRef.current, taskId, currentUserId)) {
      if (markedRef.current.has(id)) continue;
      markedRef.current.add(id);
      dispatch({ type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: taskConversationNotificationId(id) });
    }
  }, [dispatch, taskId, currentUserId]);

  const toggleFollow = async (): Promise<void> => {
    if (!conversation || followBusy) return;
    setFollowBusy(true);
    const next = !following;
    const result = await chat.setFollow(conversation.id, next);
    setFollowBusy(false);
    if (result.ok) {
      setFollowError(null);
      setAnnouncement(
        next
          ? 'Obserwujesz rozmowę. Dostaniesz powiadomienia o nowych wiadomościach.'
          : 'Nie obserwujesz rozmowy. Powiadomienia przyjdą tylko, gdy ktoś Cię oznaczy.',
      );
    } else {
      setFollowError(result.error);
    }
  };

  // Zakładki: strzałki przełączają i przenoszą fokus (wzorzec WAI-ARIA Tabs).
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    event.preventDefault();
    const next: PaneTab =
      event.key === 'Home' ? 'comments' : event.key === 'End' ? 'history' : tab === 'comments' ? 'history' : 'comments';
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <header className="n2chat-task-header">
        <h2 id={titleId} className="n2chat-task-title">
          Rozmowa
        </h2>
        <div className="n2chat-task-tabs" role="tablist" aria-label="Widok rozmowy">
          <button
            ref={(element) => {
              tabRefs.current.comments = element;
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-comments`}
            aria-selected={tab === 'comments'}
            aria-controls={panelId}
            tabIndex={tab === 'comments' ? 0 : -1}
            className="n2chat-task-tab"
            onClick={() => setTab('comments')}
            onKeyDown={onTabKeyDown}
          >
            Komentarze
            {commentCount !== null && <span className="n2chat-task-count">{commentCount}</span>}
          </button>
          <button
            ref={(element) => {
              tabRefs.current.history = element;
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-history`}
            aria-selected={tab === 'history'}
            aria-controls={panelId}
            tabIndex={tab === 'history' ? 0 : -1}
            className="n2chat-task-tab"
            onClick={() => setTab('history')}
            onKeyDown={onTabKeyDown}
          >
            Historia
            <span className="n2chat-task-count">{activity.length}</span>
          </button>
        </div>
        {conversation && (
          <div className="n2chat-task-follow">
            {followers.length > 0 && (
              <div className="n2chat-task-followers" role="img" aria-label={followersSummary(directory, followers)}>
                {shown.ids.map((userId) => (
                  <Tooltip key={userId} text={personLabel(directory, userId)} visualOnly>
                    <span className="n2chat-task-follower">
                      <ChatAvatar
                        peerId={userId}
                        initials={personInitials(directory, userId)}
                        directory={directory}
                        size={24}
                      />
                    </span>
                  </Tooltip>
                ))}
                {shown.rest > 0 && <span className="n2chat-task-follower-more">+{shown.rest}</span>}
              </div>
            )}
            <Tooltip text={following ? 'Przestań obserwować' : 'Obserwuj'}>
              <button
                type="button"
                className={`n2chat-icon-btn n2chat-task-bell${following ? ' is-on' : ''}`}
                aria-label={following ? 'Przestań obserwować rozmowę' : 'Obserwuj rozmowę'}
                aria-pressed={following}
                disabled={followBusy}
                onClick={() => void toggleFollow()}
              >
                {following ? <Bell size={17} aria-hidden /> : <BellOff size={17} aria-hidden />}
              </button>
            </Tooltip>
          </div>
        )}
      </header>
      <span role="status" aria-live="polite" className="n2chat-thread-live">
        {announcement}
      </span>
      {followError !== null && (
        <p role="alert" className="n2chat-error n2chat-task-error">
          {followError}
        </p>
      )}

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${tab}`}
        className="n2chat-task-body"
      >
        {tab === 'history' ? (
          <div className="n2chat-task-history">
            {activity.length === 0 ? (
              <p className="muted n2chat-task-empty">Brak zmian w historii zadania.</p>
            ) : (
              <ul className="activity-list">
                {activity.map((event) => {
                  const actor = getPerson(state, event.actorId);
                  const real = event.impersonatorId ? getPerson(state, event.impersonatorId) : undefined;
                  return (
                    <li key={event.id} className="activity-item">
                      <span className="activity-msg">
                        {event.impersonatorId ? (
                          <>
                            <strong>{real?.name ?? 'Ktoś'}</strong>{' '}
                            <span className="muted">(jako {actor?.name ?? 'Ktoś'})</span> {event.message}
                          </>
                        ) : (
                          <>
                            <strong>{actor?.name ?? 'Ktoś'}</strong> {event.message}
                          </>
                        )}
                      </span>
                      <span className="muted activity-time">{formatTimestamp(event.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : open.status === 'unsaved' ? (
          <p className="n2chat-task-empty">Rozmowa pojawi się po zapisaniu zadania.</p>
        ) : open.status === 'forbidden' ? (
          <p className="n2chat-task-empty" role="status">
            {open.error}
          </p>
        ) : open.status === 'failed' ? (
          <div className="n2chat-task-empty" role="alert">
            <p>{open.error}</p>
            <button type="button" className="btn ghost" onClick={() => setAttempt((n) => n + 1)}>
              Spróbuj ponownie
            </button>
          </div>
        ) : !conversation ? (
          <p className="n2chat-task-empty" role="status">
            Wczytywanie rozmowy…
          </p>
        ) : (
          <ChatThread
            variant="pane"
            conversation={conversation}
            directory={directory}
            draft={draft}
            onDraftChange={setDraft}
            onDraftRestore={(failed) => setDraft((current) => (current ? `${failed}\n${current}` : failed))}
            placeholder="Napisz do zespołu przy tym zadaniu…"
            emptyText="Brak komentarzy. Napisz pierwszy, @ oznacza osobę."
            onViewingNewest={markNotificationsRead}
          />
        )}
      </div>
    </>
  );
}
