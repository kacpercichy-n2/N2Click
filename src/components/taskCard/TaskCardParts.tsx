import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '../Tooltip';
import { MessageSquare } from 'lucide-react';
import './task-card.css';

/** Inline field shell. Existing controls retain their ids, validation and handlers. */
export function TaskTile({ label, summary, children, disabled, onBegin, onCancel, className = '' }: {
  label: string; summary: ReactNode; children: ReactNode; disabled?: boolean;
  onBegin?: () => (() => void); onCancel?: () => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (editing) panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
  }, [editing]);
  const close = () => { setEditing(false); requestAnimationFrame(() => trigger.current?.focus()); };
  return <div className={`task-card-tile ${className}`}>
    <Tooltip text={disabled ? 'Brak uprawnień do edycji zadania.' : `Edytuj: ${label}`}>
      <button ref={trigger} type="button" className="task-card-tile-trigger" aria-disabled={disabled} aria-expanded={editing}
        onClick={() => { if (!disabled) { cancel.current = onBegin?.() ?? null; setEditing(v => !v); } }}>
        <span className="task-card-tile-label">{label}</span><span className="task-card-tile-value">{summary}</span>
      </button>
    </Tooltip>
    {editing && <div ref={panel} className="task-card-tile-editor" onKeyDownCapture={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel.current?.(); onCancel?.(); close(); }
    }}>{children}<button type="button" className="btn ghost" onClick={close}>Wróć</button></div>}
  </div>;
}

/** Text drafts are committed on blur, Enter (title), or Ctrl/Cmd+Enter (description). */
export function TaskReadText({ value, onChange, label, multiline = false, disabled = false, id, error, onBlur }: {
  value: string; onChange: (value: string) => void; label: string; multiline?: boolean; disabled?: boolean; id: string; error?: string; onBlur?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  useLayoutEffect(() => {
    if (editing) { input.current?.focus(); if (multiline && input.current) {
      input.current.style.height = 'auto'; input.current.style.height = `${input.current.scrollHeight}px`;
    } }
  }, [editing, draft, multiline]);
  const finish = () => { if (!cancelled.current) onChange(draft); setEditing(false); onBlur?.(); };
  const props = { id, ref: input, value: draft, 'aria-label': label, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: finish,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled.current = true; setEditing(false); requestAnimationFrame(() => button.current?.focus()); }
      else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(); requestAnimationFrame(() => button.current?.focus()); }
    } };
  return <div className={multiline ? 'task-card-description' : 'task-card-title'}>
    {editing ? (multiline ? <textarea {...props} /> : <input {...props} />) :
      <Tooltip text={disabled ? 'Brak uprawnień do edycji zadania.' : `Edytuj: ${label}`}><button type="button" id={id} ref={button} aria-disabled={disabled}
        onClick={() => { if (!disabled) { cancelled.current = false; setDraft(value); setEditing(true); } }}>{value || (multiline ? 'Dodaj opis zadania' : 'Dodaj tytuł zadania')}</button></Tooltip>}
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>;
}

export function TaskConversationEmpty() {
  return <div className="task-card-conversation-empty"><MessageSquare size={28} aria-hidden /><p>Rozmowa pojawi się po utworzeniu zadania</p></div>;
}
