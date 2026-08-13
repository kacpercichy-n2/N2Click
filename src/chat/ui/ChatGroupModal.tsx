// Modal „Nowa grupa": tytuł + wielokrotny wybór osób. Stoi na wspólnej ramie
// `ModalFrame` (portal, stos Escape, pułapka Tab, blokada scrolla), więc nie ma
// tu żadnej własnej mechaniki okna. Walidacja używa komunikatów rdzenia
// (`CHAT_MESSAGES`), żeby ten sam błąd brzmiał tak samo z serwera i z klienta.
import { useMemo, useState } from 'react';
import { ModalFrame } from '../../components/ModalFrame';
import { useChat } from '../ChatProvider';
import { CHAT_MESSAGES } from '../types';
import { filterPeople } from './chatDockView';
import { personLabel, type ChatDirectory, type ChatPerson } from './chatPeople';

export function ChatGroupModal({
  people,
  directory,
  onClose,
}: {
  people: readonly ChatPerson[];
  directory: ChatDirectory;
  onClose: () => void;
}) {
  const chat = useChat();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const candidates = useMemo(
    () => filterPeople(people, '', chat.selfId),
    [people, chat.selfId],
  );

  const toggle = (personId: string): void => {
    setSelected((ids) =>
      ids.includes(personId) ? ids.filter((id) => id !== personId) : [...ids, personId],
    );
    setError('');
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const trimmed = title.trim();
    if (trimmed === '') {
      setError(CHAT_MESSAGES.emptyTitle);
      return;
    }
    if (selected.length === 0) {
      setError(CHAT_MESSAGES.noMembers);
      return;
    }
    setSaving(true);
    const conversationId = await chat.createGroup(trimmed, selected);
    setSaving(false);
    // Błąd serwera niesie już `chat.error` (polski komunikat) — nie dublujemy go
    // lokalnym tekstem, tylko zostawiamy modal otwarty z wpisanymi danymi.
    if (conversationId !== null) onClose();
  };

  return (
    <ModalFrame ariaLabel="Nowa grupa" cardClassName="quick-add-card" onRequestClose={onClose}>
      <div className="task-modal-head">
        <h1 className="task-modal-title">Nowa grupa</h1>
        <div className="task-modal-head-actions">
          <button type="button" className="task-modal-close" onClick={onClose} aria-label="Zamknij">
            ×
          </button>
        </div>
      </div>
      <form className="task-modal-body" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="n2chat-group-title">Nazwa grupy *</label>
          <input
            id="n2chat-group-title"
            autoFocus
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError('');
            }}
            placeholder="np. Projekt Wiosna"
          />
        </div>
        {/* `fieldset` zostaje BLOKOWY (bez `display: flex` i bez własnego
            przewijania): legenda w elastycznym kontenerze renderuje się różnie w
            różnych silnikach, a jedynym elementem przewijanym modala ma być
            `.task-modal-body` (kontrakt wspólnej ramy). */}
        <fieldset className="n2chat-members">
          <legend>Osoby *</legend>
          {candidates.length === 0 ? (
            <p className="n2chat-empty">Brak osób do wybrania.</p>
          ) : (
            candidates.map((person) => (
              <label key={person.id} className="n2chat-member">
                <input
                  type="checkbox"
                  checked={selected.includes(person.id)}
                  onChange={() => toggle(person.id)}
                />
                <span>{personLabel(directory, person.id)}</span>
              </label>
            ))
          )}
        </fieldset>
        {error !== '' && <p className="field-error">{error}</p>}
        {chat.error !== null && <p className="field-error">{chat.error}</p>}
        <div className="field-row">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Tworzenie…' : 'Utwórz'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Anuluj
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
