import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ImagePlus, RotateCw, X } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { ModalFrame } from '../../components/ModalFrame';
import { Tooltip } from '../../components/Tooltip';
import type { ChatAttachment, PendingAttachment } from './types';
import type { AttachmentUrlGetter } from './storage';
import './attachments.css';

export interface AttachmentTrayProps {
  pending: readonly PendingAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  error?: string | null;
}
export function AttachmentTray({ pending, onRemove, onRetry, error }: AttachmentTrayProps) {
  return <div className="attachment-tray-wrap">
    {pending.length > 0 && <ul className="attachment-tray" aria-label="Załączone obrazy">{pending.map(item => <li key={item.id} className="attachment-pending">
      <img src={item.previewUrl} alt={item.file.name} />
      <Tooltip text="Usuń obraz"><button type="button" className="attachment-control attachment-remove" aria-label={`Usuń ${item.file.name}`} onClick={() => onRemove(item.id)}><X size={18} /></button></Tooltip>
      {item.status === 'compressing' || item.status === 'uploading' ? <div className="attachment-progress" role="progressbar" aria-label={`Wysyłanie ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
        <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${item.progress * 100} 100`} /></svg>
        <span>{Math.round(item.progress * 100)}%</span>
      </div> : null}
      {item.status === 'error' && <div className="attachment-error"><span>{item.error}</span><Tooltip text="Spróbuj ponownie"><button type="button" className="attachment-control" aria-label={`Ponów wysyłanie ${item.file.name}`} onClick={() => onRetry(item.id)}><RotateCw size={18} /></button></Tooltip></div>}
      <span className="attachment-file-name">{item.file.name}</span>
    </li>)}</ul>}
    <div className="attachment-announcement" role="status" aria-live="polite">{error || pending.filter(item => item.status === 'error').map(item => item.error).join(' ') || (pending.length ? `Gotowe obrazy: ${pending.filter(item => item.status === 'ready').length} z ${pending.length}` : '')}</div>
  </div>;
}

function useSignedImage(path: string, getSignedUrl: AttachmentUrlGetter, enabled: boolean) {
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean }>({ path, url: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const autoRetried = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      let url: string | null = null;
      try { url = await getSignedUrl(path, { refresh: attempt > 0 }); } catch { /* user-facing fallback */ }
      if (!cancelled) setState({ path, url, failed: !url });
    })();
    return () => { cancelled = true; };
  }, [path, getSignedUrl, enabled, attempt]);
  return { url: state.path === path ? state.url : null, failed: state.path === path && state.failed,
    retry: () => setAttempt(value => value + 1),
    // An expired signature shows up as an image error: sign again once before showing the retry button.
    fail: () => {
      if (autoRetried.current !== path) { autoRetried.current = path; setAttempt(value => value + 1); return; }
      setState({ path, url: null, failed: true });
    } };
}
function AttachmentThumbnail({ attachment, getSignedUrl, onOpen, extra, single }: { attachment: ChatAttachment; getSignedUrl: AttachmentUrlGetter; onOpen: () => void; extra: number; single: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const image = useSignedImage(attachment.path, getSignedUrl, visible);
  return <Tooltip text={image.failed ? 'Nie udało się wczytać obrazu. Kliknij, aby ponowić.' : attachment.name}><button ref={ref} type="button" className="attachment-thumbnail" style={single ? { aspectRatio: `${attachment.width || 1} / ${attachment.height || 1}`, maxWidth: attachment.width || undefined } : undefined} aria-label={extra ? `Otwórz ${attachment.name}, jeszcze ${extra} obrazów` : `Otwórz ${attachment.name}`} onClick={event => { if (image.failed) { image.retry(); return; } event.currentTarget.focus(); onOpen(); }}>
    {image.url ? <img src={image.url} alt={attachment.name} width={attachment.width} height={attachment.height} loading="lazy" onError={image.fail} /> : <span>{image.failed ? 'Ponów wczytywanie' : 'Wczytywanie obrazu'}</span>}
    {extra > 0 && <span className="attachment-more">+{extra}</span>}
  </button></Tooltip>;
}
export interface AttachmentGridProps { attachments: readonly ChatAttachment[]; getSignedUrl: AttachmentUrlGetter }
export function AttachmentGrid({ attachments, getSignedUrl }: AttachmentGridProps) {
  const [index, setIndex] = useState<number | null>(null);
  if (!attachments.length) return null;
  return <><div className={`attachment-grid ${attachments.length === 1 ? 'attachment-grid-single' : ''}`}>
    {attachments.slice(0, 4).map((attachment, position) => <AttachmentThumbnail key={attachment.path} attachment={attachment} getSignedUrl={getSignedUrl} onOpen={() => setIndex(position)} extra={position === 3 ? Math.max(0, attachments.length - 4) : 0} single={attachments.length === 1} />)}
  </div>{index !== null && <ImageLightbox attachments={attachments} initialIndex={index} getSignedUrl={getSignedUrl} onClose={() => setIndex(null)} />}</>;
}
export interface ImageLightboxProps extends AttachmentGridProps { initialIndex?: number; onClose: () => void }
export function ImageLightbox({ attachments, initialIndex = 0, getSignedUrl, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [focusReturn] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => () => {
    // The shared shell restores focus before releasing root inertness.
    // Defer our return until all shell cleanup has completed.
    requestAnimationFrame(() => { if (focusReturn?.isConnected) focusReturn.focus(); });
  }, [focusReturn]);
  const currentIndex = Math.max(0, Math.min(index, attachments.length - 1));
  const attachment = attachments[currentIndex];
  const image = useSignedImage(attachment?.path ?? '', getSignedUrl, !!attachment);
  const [download, setDownload] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;
    void getSignedUrl(attachment.path, { download: attachment.name }).then(url => {
      if (!cancelled) setDownload(url ? { path: attachment.path, url } : null);
    }).catch(() => { if (!cancelled) setDownload(null); });
    return () => { cancelled = true; };
  }, [attachment, getSignedUrl]);
  const count = attachments.length;
  // Window listener: focus may sit on the dialog card itself, not inside our content.
  useEffect(() => {
    if (count < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setIndex(value => (value + (event.key === 'ArrowLeft' ? -1 : 1) + count) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);
  const move = (delta: number) => setIndex(value => (value + delta + count) % count);
  if (!attachment) return null;
  return <MotionConfig reducedMotion="user"><ModalFrame ariaLabel="Podgląd obrazu" cardClassName="attachment-lightbox" onRequestClose={onClose}>
    <div className="attachment-lightbox-content">
      <header><span aria-live="polite">{currentIndex + 1} / {attachments.length}: {attachment.name}</span>
        {download?.path === attachment.path && <Tooltip text="Pobierz obraz"><a className="attachment-control" href={download.url} download={attachment.name} aria-label="Pobierz obraz"><Download size={20} /></a></Tooltip>}
        <Tooltip text="Zamknij podgląd"><button type="button" className="attachment-control" onClick={onClose} aria-label="Zamknij podgląd"><X size={20} /></button></Tooltip>
      </header>
      <div className="attachment-lightbox-image">{image.url ? <img src={image.url} alt={attachment.name} onError={image.fail} /> : image.failed ? <button type="button" className="attachment-control" onClick={image.retry}>Ponów wczytywanie</button> : <span role="status">Wczytywanie obrazu</span>}</div>
      {attachments.length > 1 && <nav aria-label="Wybór obrazu"><Tooltip text="Poprzedni obraz"><button type="button" className="attachment-control" onClick={() => move(-1)} aria-label="Poprzedni obraz"><ChevronLeft size={24} /></button></Tooltip><Tooltip text="Następny obraz"><button type="button" className="attachment-control" onClick={() => move(1)} aria-label="Następny obraz"><ChevronRight size={24} /></button></Tooltip></nav>}
    </div>
  </ModalFrame></MotionConfig>;
}
export function DropZoneOverlay({ active }: { active: boolean }) {
  return active ? <div className="attachment-dropzone" aria-hidden="true"><ImagePlus size={28} /><span>Upuść obrazy, aby je dodać</span></div> : null;
}
