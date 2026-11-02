import { CHAT_ATTACHMENT_MAX_INPUT_BYTES, CHAT_ATTACHMENTS_MAX } from './types';
import type { ChatAttachment } from './types';

export const ATTACHMENT_TYPES: Record<ChatAttachment['mime'], string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};
export function validateAttachmentFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, file.type)) return 'Dozwolone formaty: PNG, JPG, WebP i GIF.';
  if (file.size <= 0) return 'Plik jest pusty.';
  if (file.size > CHAT_ATTACHMENT_MAX_INPUT_BYTES) return 'Obraz jest za duży. Maksymalny rozmiar to 10 MB.';
  return null;
}
export function validateAttachmentCount(incoming: number, existing = 0): string | null {
  return incoming + existing > CHAT_ATTACHMENTS_MAX ? 'Możesz dodać maksymalnie 10 obrazów do wiadomości.' : null;
}
export function attachmentTargetSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Nieprawidłowe wymiary obrazu.');
  const scale = Math.min(1, 2560 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function attachmentObjectPath(conversationId: string, mime: ChatAttachment['mime'], uuid: string = crypto.randomUUID()): string {
  if (!/^[a-zA-Z0-9-]+$/.test(conversationId) || !/^[a-zA-Z0-9-]+$/.test(uuid)) throw new Error('Nieprawidłowa ścieżka obrazu.');
  return `${conversationId}/${uuid}.${ATTACHMENT_TYPES[mime]}`;
}
function transferFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files ?? []);
  if (files.length) return files;
  return Array.from(transfer.items ?? []).flatMap(item => {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}
export function imagesFromClipboard(event: Pick<ClipboardEvent, 'clipboardData'>, now = new Date()): File[] {
  return transferFiles(event.clipboardData).filter(f => f.type.startsWith('image/')).map(file => {
    if (!/^image\.png$/i.test(file.name)) return file;
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return new File([file], `Zrzut ekranu ${time}`, { type: file.type, lastModified: file.lastModified });
  });
}
export function imagesFromDrop(event: Pick<DragEvent, 'dataTransfer'>): File[] {
  return transferFiles(event.dataTransfer).filter(f => f.type.startsWith('image/'));
}
export interface PreparedAttachment { blob: Blob; mime: ChatAttachment['mime']; width: number; height: number }
/** Decode once; object URL is always released, including corrupt input. */
export async function compressAttachment(file: File): Promise<PreparedAttachment> {
  const error = validateAttachmentFile(file);
  if (error) throw new Error(error);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const original = { blob: file, mime: file.type as ChatAttachment['mime'], width: image.naturalWidth, height: image.naturalHeight };
    const size = attachmentTargetSize(original.width, original.height);
    if (file.type === 'image/gif') return original;
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Nie udało się przygotować obrazu.');
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    // Browsers without WebP encoding may return PNG. Preserve the real MIME.
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return original;
    return { blob, mime: 'image/webp', ...size };
  } finally { URL.revokeObjectURL(url); }
}
