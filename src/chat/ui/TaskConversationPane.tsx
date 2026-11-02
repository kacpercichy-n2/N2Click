import { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { CommentsPanel } from '../../components/CommentsPanel';
import { Tooltip } from '../../components/Tooltip';
import { useStore } from '../../store/AppStore';
import { activityFor, getPerson } from '../../store/selectors';
import { useOrgData } from '../../supabase/OrgDataProvider';
import { formatTimestamp } from '../../utils/dates';
import { useChat } from '../ChatProvider';
import { ChatThread } from './ChatThread';
import { ChatAvatar } from './ChatAvatar';
import { buildDirectory, personInitials, personLabel } from './chatPeople';
import './chat-thread.css';

export interface TaskConversationPaneProps { taskId: string }

export function TaskConversationPane({ taskId }: TaskConversationPaneProps) {
  const chat = useChat();
  return <section className="n2chat-task-pane" aria-label="Rozmowa o zadaniu">
    {chat.enabled ? <CloudTaskConversation key={taskId} taskId={taskId} /> : <CommentsPanel entityType="task" entityId={taskId} />}
  </section>;
}

function CloudTaskConversation({ taskId }: TaskConversationPaneProps) {
  const chat = useChat();
  const { state } = useStore();
  const org = useOrgData();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [draft, setDraft] = useState('');
  const [followingBusy, setFollowingBusy] = useState(false);
  const activity = useMemo(() => [...activityFor(state, 'task', taskId)].reverse(), [state, taskId]);
  const directory = useMemo(() => buildDirectory(org.state.status === 'ready' ? org.state.snapshot.profiles : []), [org.state]);
  const openTaskConversation = chat.openTaskConversation;
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void openTaskConversation(taskId).then(id => {
      if (cancelled) return;
      setConversationId(id);
      setFailed(!id);
    });
    return () => { cancelled = true; };
  }, [taskId, openTaskConversation, attempt]);
  const conversation = chat.conversations.find(c => c.id === conversationId);
  const following = conversation?.members.find(m => m.userId === chat.selfId)?.mutedUntil !== 'infinity';
  const followers = conversation?.members.filter(m => !m.mutedUntil || Date.parse(m.mutedUntil) < Date.now()) ?? [];
  return <>
    <header className="n2chat-task-header">
      <h3>Rozmowa</h3>
      <button type="button" className="btn ghost" aria-pressed={tab === 'comments'} onClick={() => setTab('comments')}>Komentarze ({chat.openConversationId === conversationId ? chat.messages.filter(m => m.kind === 'text' && !m.deletedAt).length : '…'})</button>
      <button type="button" className="btn ghost" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Historia ({activity.length})</button>
      <div className="n2chat-task-followers">{followers.map(member => <Tooltip key={member.userId} text={personLabel(directory, member.userId)}><span tabIndex={0} aria-label={personLabel(directory, member.userId)}><ChatAvatar peerId={member.userId} initials={personInitials(directory, member.userId)} directory={directory} size={22} /></span></Tooltip>)}</div>
      {conversation && <Tooltip text={following ? 'Przestań obserwować' : 'Obserwuj'}><button type="button" className="btn ghost" aria-label={following ? 'Przestań obserwować' : 'Obserwuj'} aria-pressed={following} disabled={followingBusy} onClick={() => {
        setFollowingBusy(true);
        void chat.setFollow(conversation.id, !following).finally(() => setFollowingBusy(false));
      }}>{following ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}</button></Tooltip>}
    </header>
    {tab === 'history' ? <div className="n2chat-task-history">{activity.length === 0 ? <p className="muted">Brak aktywności.</p> : <ul className="activity-list">{activity.map(event => <li key={event.id}><strong>{getPerson(state, event.impersonatorId || event.actorId)?.name || 'Ktoś'}</strong>{event.impersonatorId && <> (jako {getPerson(state, event.actorId)?.name || 'Ktoś'})</>} {event.message}<br /><span className="muted">{formatTimestamp(event.createdAt)}</span></li>)}</ul>}</div>
      : !conversation ? <div className="n2chat-task-history" role="status">{failed ? <><p>{chat.error || 'Nie udało się otworzyć rozmowy.'}</p><button type="button" className="btn ghost" onClick={() => setAttempt(value => value + 1)}>Spróbuj ponownie</button></> : 'Wczytywanie rozmowy…'}</div>
      : chat.openConversationId !== conversation.id ? <div className="n2chat-task-history"><button type="button" className="btn ghost" onClick={() => chat.openConversation(conversation.id)}>Wróć do rozmowy o zadaniu</button></div>
      : <ChatThread embedded conversation={conversation} directory={directory} draft={draft} onDraftChange={setDraft} onDraftRestore={text => setDraft(current => current ? `${text}\n${current}` : text)} onDismiss={() => {}} />}
  </>;
}
