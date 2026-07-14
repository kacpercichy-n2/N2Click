// Chat/comments section for a project or task detail card, with @mentions,
// timestamps, and the entity's activity log. Comment author = the "acting as"
// person selected in the header.
import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import type { CommentEntityType, Person } from '../types';
import {
  activityFor,
  commentsFor,
  currentUser,
  getPerson,
} from '../store/selectors';
import { Avatar } from './Avatar';
import { formatTimestamp } from '../utils/dates';

interface Props {
  entityType: CommentEntityType;
  entityId: string;
}

/**
 * Find @mentions in a body: "@First" or "@First Last" (case-insensitive),
 * matched against the team. Returns the mentioned person ids.
 */
export function parseMentions(body: string, people: Person[]): string[] {
  const lower = body.toLowerCase();
  const ids: string[] = [];
  for (const p of people) {
    const first = p.firstName.toLowerCase();
    if (!first) continue;
    if (lower.includes(`@${p.name.toLowerCase()}`) || lower.includes(`@${first}`)) {
      ids.push(p.id);
    }
  }
  return ids;
}

/** Render a comment body with @mention tokens highlighted. */
function MentionBody({ body, people }: { body: string; people: Person[] }) {
  const names = people
    .flatMap((p) => [p.name, p.firstName])
    .filter(Boolean)
    // Longest first so "@Ola Nowak" wins over "@Ola".
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (names.length === 0) return <>{body}</>;
  const re = new RegExp(`@(?:${names.join('|')})`, 'gi');
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push(
      <span key={k++} className="mention">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <>{parts}</>;
}

export function CommentsPanel({ entityType, entityId }: Props) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [body, setBody] = useState('');

  const comments = commentsFor(state, entityType, entityId);
  const activity = useMemo(
    () => [...activityFor(state, entityType, entityId)].reverse(),
    [state, entityType, entityId],
  );
  const me = currentUser(state);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    dispatch({
      type: 'ADD_COMMENT',
      entityType,
      entityId,
      body: trimmed,
      mentionIds: parseMentions(trimmed, state.people),
    });
    setBody('');
  };

  const insertMention = (p: Person) => {
    setBody((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${p.firstName} `);
  };

  return (
    <div className="comments-panel">
      <div className="comments-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'comments'}
          className={tab === 'comments' ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => setTab('comments')}
        >
          Komentarze ({comments.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'activity'}
          className={tab === 'activity' ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => setTab('activity')}
        >
          Aktywność ({activity.length})
        </button>
      </div>

      {tab === 'comments' ? (
        <>
          {comments.length === 0 ? (
            <p className="muted comments-empty">Brak komentarzy.</p>
          ) : (
            <ul className="comment-list">
              {comments.map((c) => {
                const author = getPerson(state, c.authorId);
                return (
                  <li key={c.id} className="comment-item">
                    {author ? (
                      <Avatar person={author} size={28} />
                    ) : (
                      <span className="avatar avatar-unknown">?</span>
                    )}
                    <div className="comment-main">
                      <div className="comment-head">
                        <strong>{author?.name ?? 'Ktoś'}</strong>
                        <span className="muted comment-time">
                          {formatTimestamp(c.createdAt)}
                        </span>
                      </div>
                      <div className="comment-body">
                        <MentionBody body={c.body} people={state.people} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <form className="comment-form" onSubmit={submit}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder={
                me
                  ? `Komentujesz jako ${me.name}… użyj @imię, żeby kogoś oznaczyć`
                  : 'Napisz komentarz… (wybierz użytkownika w nagłówku, żeby go podpisać)'
              }
            />
            <div className="comment-form-actions">
              <div className="mention-chips">
                {state.people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="link-btn"
                    onClick={() => insertMention(p)}
                    title={`Oznacz ${p.name}`}
                  >
                    @{p.firstName}
                  </button>
                ))}
              </div>
              <button type="submit" className="btn primary" disabled={!body.trim()}>
                Skomentuj
              </button>
            </div>
          </form>
        </>
      ) : activity.length === 0 ? (
        <p className="muted comments-empty">Brak aktywności.</p>
      ) : (
        <ul className="activity-list">
          {activity.map((e) => {
            const actor = getPerson(state, e.actorId);
            // Impersonated row: show the REAL administrator as the primary name
            // and the acted-as identity in a suffix. This is a local attribution
            // aid, not a security audit trail.
            const real = e.impersonatorId ? getPerson(state, e.impersonatorId) : undefined;
            return (
              <li key={e.id} className="activity-item">
                <span className="activity-msg">
                  {e.impersonatorId ? (
                    <>
                      <strong>{real?.name ?? 'Ktoś'}</strong>{' '}
                      <span className="muted">(jako {actor?.name ?? 'Ktoś'})</span> {e.message}
                    </>
                  ) : (
                    <>
                      <strong>{actor?.name ?? 'Ktoś'}</strong> {e.message}
                    </>
                  )}
                </span>
                <span className="muted activity-time">{formatTimestamp(e.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
