import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import type { PendingAttachment } from './types';
import type { AttachmentRemover, AttachmentUploader } from './storage';
import { imagesFromClipboard, imagesFromDrop, validateAttachmentCount, validateAttachmentFile } from './files';

export function useAttachmentQueue(conversationId: string, uploader: AttachmentUploader, remover?: AttachmentRemover) {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const entries = useRef<PendingAttachment[]>([]);
  const generation = useRef(0);
  const removerRef = useRef(remover);
  removerRef.current = remover;
  // Best effort: a failed delete only leaves an unreferenced object, nothing the user can act on.
  const discard = useCallback((path: string) => { try { void removerRef.current?.(path)?.catch(() => undefined); } catch { /* ignored */ } }, []);
  const chain = useRef(Promise.resolve());
  const publish = useCallback((next: PendingAttachment[]) => { entries.current = next; setPending(next); }, []);
  const clear = useCallback(() => {
    generation.current++;
    entries.current.forEach(item => URL.revokeObjectURL(item.previewUrl));
    publish([]); setError(null);
    chain.current = Promise.resolve();
  }, [publish]);
  useEffect(() => {
    clear();
    return () => {
      generation.current++;
      entries.current.forEach(item => URL.revokeObjectURL(item.previewUrl));
      entries.current = [];
    };
  }, [conversationId, clear]);
  const run = useCallback((item: PendingAttachment) => {
    const version = generation.current;
    const active = () => version === generation.current && entries.current.some(entry => entry.id === item.id);
    const update = (patch: Partial<PendingAttachment>) => {
      if (active()) publish(entries.current.map(entry => entry.id === item.id ? { ...entry, ...patch } : entry));
    };
    // Serialize decoding to avoid ten full-resolution canvas allocations at once.
    chain.current = chain.current.then(async () => {
      if (!active()) return;
      try {
        const result = await uploader(conversationId, item.file, progress => update({ progress: Math.max(0, Math.min(1, progress)), status: progress >= 0.2 ? 'uploading' : 'compressing' }));
        if (result.ok && version === generation.current && !entries.current.some(entry => entry.id === item.id)) discard(result.attachment.path);
        else if (result.ok) update({ status: 'ready', progress: 1, result: result.attachment, error: null });
        else update({ status: 'error', error: result.error });
      } catch { update({ status: 'error', error: 'Nie udało się wysłać obrazu. Spróbuj ponownie.' }); }
    });
  }, [conversationId, uploader, publish, discard]);
  const addFiles = useCallback((files: Iterable<File> | ArrayLike<File>) => {
    const incoming = Array.from(files);
    const countError = validateAttachmentCount(incoming.length, entries.current.length);
    if (countError) { setError(countError); return; }
    const errors: string[] = [];
    const items = incoming.flatMap(file => {
      const invalid = validateAttachmentFile(file);
      if (invalid) { errors.push(`${file.name}: ${invalid}`); return []; }
      return [{ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), status: 'compressing' as const, progress: 0, error: null, result: null }];
    });
    publish([...entries.current, ...items]); setError(errors.join(' ') || null);
    items.forEach(run);
  }, [publish, run]);
  const remove = useCallback((id: string) => {
    const item = entries.current.find(entry => entry.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    publish(entries.current.filter(entry => entry.id !== id));
    if (item?.status === 'ready' && item.result) discard(item.result.path);
  }, [publish, discard]);
  const retry = useCallback((id: string) => {
    const item = entries.current.find(entry => entry.id === id && entry.status === 'error');
    if (!item) return;
    publish(entries.current.map(entry => entry.id === id ? { ...entry, status: 'compressing', error: null, progress: 0 } : entry));
    run(item);
  }, [publish, run]);
  const onPaste = (event: ClipboardEvent | ReactClipboardEvent) => {
    const files = imagesFromClipboard(event);
    if (files.length) { event.preventDefault(); addFiles(files); }
  };
  const onDrop = (event: DragEvent | ReactDragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); addFiles(imagesFromDrop(event));
  };
  return { pending, error, addFiles, remove, retry, clear, onPaste, onDrop,
    allReady: pending.every(item => item.status === 'ready'),
    attachments: pending.flatMap(item => item.result ? [item.result] : []),
  };
}
