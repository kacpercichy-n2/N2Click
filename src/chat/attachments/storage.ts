import type { SupabaseClient } from '@supabase/supabase-js';
import { CHAT_ATTACHMENT_BUCKET } from './types';
import type { ChatAttachment } from './types';
import { attachmentObjectPath, compressAttachment } from './files';

export type AttachmentUploadResult = { ok: true; attachment: ChatAttachment } | { ok: false; error: string };
export type AttachmentUploader = (conversationId: string, file: File, onProgress: (progress: number) => void) => Promise<AttachmentUploadResult>;
/** Best-effort delete of one uploaded object. Resolves true when storage accepted the delete. */
export type AttachmentRemover = (path: string) => Promise<boolean>;
export type AttachmentUrlGetter = (path: string, options?: { download?: string; refresh?: boolean }) => Promise<string | null>;
/** Instance cache: never share signatures between clients/sessions. Recreate on auth change. */
export function createAttachmentStorage(client: SupabaseClient, now = Date.now) {
  const cache = new Map<string, { url: string; expires: number }>();
  const inflight = new Map<string, Promise<string | null>>();
  const getSignedUrl: AttachmentUrlGetter = async (path, options = {}) => {
    const key = JSON.stringify([path, options.download ?? null]);
    const entry = cache.get(key);
    if (!options.refresh && entry && entry.expires - now() > 300_000) return entry.url;
    const pending = inflight.get(key);
    if (pending) return pending;
    const request = (async () => {
      try {
        const { data, error } = await client.storage.from(CHAT_ATTACHMENT_BUCKET).createSignedUrl(path, 3600, options.download ? { download: options.download } : undefined);
        if (error || !data?.signedUrl) return null;
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(key, { url: data.signedUrl, expires: now() + 3600_000 });
        return data.signedUrl;
      } catch { return null; }
    })();
    inflight.set(key, request);
    try { return await request; } finally { inflight.delete(key); }
  };
  const upload: AttachmentUploader = async (conversationId, file, onProgress) => {
    try {
      onProgress(0);
      const prepared = await compressAttachment(file);
      const path = attachmentObjectPath(conversationId, prepared.mime);
      onProgress(0.2);
      const { error } = await client.storage.from(CHAT_ATTACHMENT_BUCKET).upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
      if (error) return { ok: false, error: 'Nie udało się wysłać obrazu. Spróbuj ponownie.' };
      onProgress(1);
      return { ok: true, attachment: { path, mime: prepared.mime, width: prepared.width, height: prepared.height, size: prepared.blob.size, name: file.name } };
    } catch (error) {
      return { ok: false, error: error instanceof Error && /^(Dozwolone|Plik|Obraz|Nieprawidłowe)/.test(error.message) ? error.message : 'Nie udało się przygotować obrazu. Spróbuj ponownie.' };
    }
  };
  const remove: AttachmentRemover = async path => {
    try {
      const { error } = await client.storage.from(CHAT_ATTACHMENT_BUCKET).remove([path]);
      return !error;
    } catch { return false; }
  };
  return { upload, remove, getSignedUrl, clearCache: () => cache.clear() };
}
