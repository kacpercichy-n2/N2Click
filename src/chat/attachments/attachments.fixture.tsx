/** Fixture for attachments.e2e.mjs (real browser test). Not an application route. */
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation } from 'motion/react';
import { AttachmentGrid, AttachmentTray, DropZoneOverlay, useAttachmentQueue } from './index';
import type { AttachmentUploader, AttachmentUrlGetter, ChatAttachment } from './index';
import '../../styles.css';
const sample = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#241440"/><circle cx="400" cy="250" r="120" fill="#7000ff"/><text x="400" y="260" text-anchor="middle" fill="white" font-size="24">Podgląd obrazu</text></svg>');
// Paths named `expired*` fail to load until the component asks for a refreshed signature.
const getSignedUrl: AttachmentUrlGetter = async (path, options) => path.includes('expired') && !options?.refresh ? 'data:image/png;base64,AAAA' : sample;
function Story() {
  const [conversation, setConversation] = useState('conversation');
  const [dragging, setDragging] = useState(false);
  const uploader = useMemo<AttachmentUploader>(() => {
    const failed = new Set<string>();
    return async (_conversation, file, progress) => {
      progress(0.2); await new Promise(resolve => setTimeout(resolve, 100));
      if (file.name.startsWith('retry') && !failed.has(file.name)) { failed.add(file.name); return { ok: false, error: 'Nie udało się wysłać obrazu.' }; }
      return { ok: true, attachment: { path: `conversation/${file.name}`, mime: 'image/png', width: 800, height: 500, size: file.size, name: file.name } };
    };
  }, []);
  const queue = useAttachmentQueue(conversation, uploader);
  const attachments: ChatAttachment[] = Array.from({ length: 6 }, (_, i) => ({ path: `conversation/${i}.png`, mime: 'image/png', width: 800, height: 500, size: 100, name: `Projekt ${i + 1}` }));
  return <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}><h1>Obrazy w rozmowie</h1><p>Podgląd załączników i kolejki wysyłania.</p>
    <AttachmentGrid attachments={attachments} getSignedUrl={getSignedUrl} />
    <AttachmentGrid attachments={[{ path: 'conversation/expired.png', mime: 'image/png', width: 800, height: 500, size: 100, name: 'Wygasły' }]} getSignedUrl={getSignedUrl} />
    <div style={{ position: 'relative', marginTop: 24 }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { setDragging(false); queue.onDrop(event); }}>
      <AttachmentTray pending={queue.pending} error={queue.error} onRemove={queue.remove} onRetry={queue.retry} />
      <textarea aria-label="Wiadomość" onPaste={queue.onPaste} placeholder="Napisz wiadomość" />
      <label>Dodaj obrazy<input aria-label="Dodaj obrazy" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { if (event.target.files) queue.addFiles(event.target.files); event.target.value = ''; }} /></label>
      <DropZoneOverlay active={dragging} />
    </div><button className="attachment-control" type="button" onClick={queue.clear}>Wyczyść</button><button className="attachment-control" type="button" onClick={() => setConversation(c => c + '1')}>Zmień rozmowę</button>
    <output data-testid="queue-state">{queue.pending.length}:{String(queue.allReady)}:{queue.attachments.length}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LazyMotion features={domAnimation}><Story /></LazyMotion>);
