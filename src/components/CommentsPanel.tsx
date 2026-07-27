// Chat/comments section for a project or task detail card, with @mentions,
// timestamps, and the entity's activity log. Comment author = the "acting as"
// person selected in the header.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { applyMention, filterMentionPeople, mentionQueryAt } from './mentionAutocomplete';

interface Props {
  entityType: CommentEntityType;
  entityId: string;
  /** Wysokość pola nowego komentarza (liczba wierszy). Domyślnie 2; karta
   *  projektu przekazuje więcej, żeby dyskusja była wygodniejsza. */
  inputRows?: number;
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

export function CommentsPanel({ entityType, entityId, inputRows = 2 }: Props) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [body, setBody] = useState('');
  // --- Podpowiedzi @wzmianek (logika w ./mentionAutocomplete) ---
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Kursor ustawiany po wstawieniu wzmianki, dopięty w efekcie po zmianie `body`.
  const pendingCaretRef = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  // Escape/blur chowa listę; kolejna zmiana tekstu otwiera ją ponownie.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

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

  const range = useMemo(
    () => (dismissed ? null : mentionQueryAt(body, caret)),
    [body, caret, dismissed],
  );
  const options = useMemo(
    () => (range ? filterMentionPeople(state.people, range.query) : []),
    [range, state.people],
  );
  const open = range !== null && options.length > 0;
  // Czytamy zawsze przyciętą wartość — lista mogła się skrócić między renderami.
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    setActive(0);
  }, [range?.query, options.length]);

  // Po wstawieniu wzmianki wracamy fokusem do pola i ustawiamy kursor za spacją.
  useEffect(() => {
    const next = pendingCaretRef.current;
    if (next === null) return;
    pendingCaretRef.current = null;
    taRef.current?.focus();
    taRef.current?.setSelectionRange(next, next);
    setCaret(next);
  }, [body]);

  const insertSuggestion = (p: Person) => {
    if (!range) return;
    const { text, caret: next } = applyMention(body, range, p);
    pendingCaretRef.current = next;
    setBody(text);
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Przy zamkniętej liście nie dotykamy klawiatury: Enter dalej robi nową linię.
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (Math.min(i, options.length - 1) + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (Math.min(i, options.length - 1) - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insertSuggestion(options[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDismissed(true);
    }
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
            <div className="comment-input-wrap">
              <textarea
                ref={taRef}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setCaret(e.currentTarget.selectionStart ?? 0);
                  setDismissed(false);
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={onTextareaKeyDown}
                onBlur={() => setDismissed(true)}
                rows={inputRows}
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
                placeholder={
                  me
                    ? `Komentujesz jako ${me.name}… użyj @imię, żeby kogoś oznaczyć`
                    : 'Napisz komentarz… (wybierz użytkownika w nagłówku, żeby go podpisać)'
                }
              />
              {open ? (
                <ul className="mention-autocomplete" id={listId} role="listbox" aria-label="Podpowiedzi wzmianek">
                  {options.map((p, i) => (
                    <li key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === activeIndex}>
                      <button
                        type="button"
                        className={i === activeIndex ? 'mention-option active' : 'mention-option'}
                        // Nie zabieramy fokusu polu — inaczej blur zamknąłby listę
                        // zanim klik zdąży wstawić wzmiankę.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertSuggestion(p)}
                      >
                        <strong>@{p.firstName}</strong>
                        <span className="muted">{p.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
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
