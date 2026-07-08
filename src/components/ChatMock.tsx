// Team presence + chat — an EXPLICIT MOCKUP. Nothing here is persisted: presence
// is a deterministic-per-day fake and every message lives only in component state
// (lost on unmount). No storage, no AppStore, no timers beyond a single canned-
// reply setTimeout. Do NOT wire this to real data.
import { useEffect, useRef, useState } from 'react';
import type { Person } from '../types';
import { Avatar } from './Avatar';
import { todayStr } from '../utils/dates';

type Presence = 'online' | 'away' | 'offline';

const PRESENCE_LABEL: Record<Presence, string> = {
  online: 'Dostępny(a)',
  away: 'Zajęty(a)',
  offline: 'Niedostępny(a)',
};

const CANNED_REPLY = 'To tylko podgląd czatu — funkcja w przygotowaniu.';

/** Deterministic per-(person, day) fake presence. Pure — no Date beyond today's string. */
function presenceFor(personId: string): Presence {
  const seed = personId + todayStr();
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  const bucket = Math.abs(h) % 3;
  return bucket === 0 ? 'online' : bucket === 1 ? 'away' : 'offline';
}

interface ChatMessage {
  id: number;
  mine: boolean;
  body: string;
}

export function ChatMock({ coworkers }: { coworkers: Person[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const seq = useRef(0);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = coworkers.find((p) => p.id === openId);

  // Reset the conversation when switching person / closing.
  function openChat(id: string) {
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setOpenId(id);
    setMessages([]);
    setDraft('');
  }

  function closeChat() {
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setOpenId(null);
    setMessages([]);
    setDraft('');
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const mineId = ++seq.current;
    setMessages((m) => [...m, { id: mineId, mine: true, body }]);
    setDraft('');
    if (replyTimer.current) clearTimeout(replyTimer.current);
    replyTimer.current = setTimeout(() => {
      setMessages((m) => [...m, { id: ++seq.current, mine: false, body: CANNED_REPLY }]);
    }, 1000);
  }

  // Clean up the pending reply timer on unmount.
  useEffect(() => () => {
    if (replyTimer.current) clearTimeout(replyTimer.current);
  }, []);

  return (
    <>
      {coworkers.length === 0 ? (
        <p className="muted">Brak innych osób w zespole.</p>
      ) : (
        <ul className="chat-people">
          {coworkers.map((p) => {
            const presence = presenceFor(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="chat-person"
                  onClick={() => openChat(p.id)}
                >
                  <Avatar person={p} size={32} />
                  <span className="chat-person-text">
                    <span className="chat-person-name">{p.name}</span>
                    <span className="chat-person-role">{p.role || 'Zespół'}</span>
                  </span>
                  <span
                    className={`presence-dot presence-${presence}`}
                    title={PRESENCE_LABEL[presence]}
                    aria-label={PRESENCE_LABEL[presence]}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="chat-popup" role="dialog" aria-label={`Czat: ${open.name}`}>
          <header className="chat-popup-head">
            <Avatar person={open} size={28} />
            <span className="chat-popup-text">
              <span className="chat-popup-name">{open.name}</span>
              <span className={`chat-popup-presence presence-${presenceFor(open.id)}`}>
                {PRESENCE_LABEL[presenceFor(open.id)]}
              </span>
            </span>
            <button
              type="button"
              className="chat-popup-close"
              onClick={closeChat}
              aria-label="Zamknij czat"
            >
              ×
            </button>
          </header>
          <div className="chat-popup-body">
            {messages.length === 0 ? (
              <p className="chat-empty muted">Napisz wiadomość, aby rozpocząć rozmowę.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`chat-msg ${m.mine ? 'mine' : 'theirs'}`}>
                  {m.body}
                </div>
              ))
            )}
          </div>
          <form className="chat-popup-input" onSubmit={send}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Napisz wiadomość…"
              aria-label="Treść wiadomości"
            />
            <button type="submit" className="btn primary">
              Wyślij
            </button>
          </form>
        </div>
      )}
    </>
  );
}
