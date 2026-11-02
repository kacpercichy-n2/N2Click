import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAttachmentStorage } from './storage';
import { compressAttachment } from './files';
vi.mock('./files', async original => ({ ...await original<typeof import('./files')>(), compressAttachment: vi.fn() }));
afterEach(() => vi.resetAllMocks());
function setup() {
  let now = 0;
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'signed' }, error: null });
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ createSignedUrl, upload, remove }));
  const adapter = createAttachmentStorage({ storage: { from } } as unknown as SupabaseClient, () => now);
  return { adapter, createSignedUrl, upload, remove, from, advance: (value: number) => { now += value; } };
}
describe('injected attachment storage', () => {
  it('deduplicates URL requests and refreshes five minutes before expiry', async () => {
    const s = setup();
    expect(await Promise.all([s.adapter.getSignedUrl('c/a.webp'), s.adapter.getSignedUrl('c/a.webp')])).toEqual(['signed', 'signed']);
    expect(s.createSignedUrl).toHaveBeenCalledTimes(1);
    s.advance(3_299_000); await s.adapter.getSignedUrl('c/a.webp');
    expect(s.createSignedUrl).toHaveBeenCalledTimes(1);
    s.advance(1000); await s.adapter.getSignedUrl('c/a.webp');
    expect(s.createSignedUrl).toHaveBeenCalledTimes(2);
    await s.adapter.getSignedUrl('c/a.webp', { refresh: true });
    expect(s.createSignedUrl).toHaveBeenCalledTimes(3);
    await s.adapter.getSignedUrl('c/a.webp', { download: 'photo.webp' });
    expect(s.createSignedUrl).toHaveBeenLastCalledWith('c/a.webp', 3600, { download: 'photo.webp' });
    expect(s.from).toHaveBeenCalledWith('chat-attachments');
  });
  it('does not cache failed requests and isolates adapters', async () => {
    const s = setup();
    s.createSignedUrl.mockRejectedValueOnce(new Error('offline'));
    expect(await s.adapter.getSignedUrl('c/a')).toBeNull();
    expect(await s.adapter.getSignedUrl('c/a')).toBe('signed');
    const other = setup(); await other.adapter.getSignedUrl('c/a');
    expect(other.createSignedUrl).toHaveBeenCalledTimes(1);
    s.adapter.clearCache(); await s.adapter.getSignedUrl('c/a');
    expect(s.createSignedUrl).toHaveBeenCalledTimes(3);
  });
  it('uploads without overwrite and reports coarse progress with final metadata', async () => {
    const s = setup(); const progress = vi.fn();
    const blob = new Blob(['webp'], { type: 'image/webp' });
    vi.mocked(compressAttachment).mockResolvedValue({ blob, mime: 'image/webp', width: 10, height: 20 });
    const result = await s.adapter.upload('conversation', new File(['input'], 'original.png'), progress);
    expect(result).toMatchObject({ ok: true, attachment: { mime: 'image/webp', width: 10, height: 20, size: 4, name: 'original.png' } });
    expect(s.upload).toHaveBeenCalledWith(expect.stringMatching(/^conversation\/.+\.webp$/), blob, { contentType: 'image/webp', upsert: false });
    expect(progress.mock.calls.flat()).toEqual([0, 0.2, 1]);
  });
  it('returns a Polish failure without exposing server errors', async () => {
    const s = setup();
    vi.mocked(compressAttachment).mockRejectedValue(new Error('private internals'));
    expect(await s.adapter.upload('c', new File(['a'], 'a.png'), vi.fn())).toEqual({ ok: false, error: 'Nie udało się przygotować obrazu. Spróbuj ponownie.' });
    expect(s.upload).not.toHaveBeenCalled();
  });
  it('removes one object from the chat bucket and never throws', async () => {
    const s = setup();
    expect(await s.adapter.remove('c/a.webp')).toBe(true);
    expect(s.remove).toHaveBeenCalledWith(['c/a.webp']);
    expect(s.from).toHaveBeenCalledWith('chat-attachments');
    s.remove.mockResolvedValueOnce({ error: { message: 'denied' } });
    expect(await s.adapter.remove('c/a.webp')).toBe(false);
    s.remove.mockRejectedValueOnce(new Error('offline'));
    expect(await s.adapter.remove('c/a.webp')).toBe(false);
  });
});
