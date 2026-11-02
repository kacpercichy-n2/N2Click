import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentObjectPath, attachmentTargetSize, compressAttachment, imagesFromClipboard, imagesFromDrop, validateAttachmentCount, validateAttachmentFile } from './files';

afterEach(() => vi.unstubAllGlobals());
const file = (type = 'image/png', size = 5) => new File([new Uint8Array(size)], 'image.png', { type });
describe('attachment file policy', () => {
  it('accepts exactly the four MIME types up to 10 MiB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) expect(validateAttachmentFile({ type, size: 10 * 1024 * 1024 })).toBeNull();
    expect(validateAttachmentFile({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toContain('10 MB');
    for (const type of ['image/svg+xml', 'text/plain', '', 'toString']) expect(validateAttachmentFile({ type, size: 2 })).toContain('Dozwolone');
    expect(validateAttachmentFile({ type: 'image/png', size: 0 })).toContain('pusty');
  });
  it('includes existing files in the ten-image limit', () => {
    expect(validateAttachmentCount(3, 7)).toBeNull();
    expect(validateAttachmentCount(4, 7)).toContain('10');
  });
  it('scales landscape and portrait without enlarging', () => {
    expect(attachmentTargetSize(5120, 2560)).toEqual({ width: 2560, height: 1280 });
    expect(attachmentTargetSize(1000, 4000)).toEqual({ width: 640, height: 2560 });
    expect(attachmentTargetSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(attachmentTargetSize(1, 50000)).toEqual({ width: 1, height: 2560 });
    for (const width of [0, -1, NaN, Infinity]) expect(() => attachmentTargetSize(width, 100)).toThrow();
  });
  it('builds paths from output MIME and rejects folder traversal', () => {
    expect(attachmentObjectPath('conversation', 'image/jpeg', 'uuid')).toBe('conversation/uuid.jpg');
    expect(() => attachmentObjectPath('../other', 'image/png', 'uuid')).toThrow();
  });
  it('renames pasted screenshots and preserves normal image names', () => {
    const screenshot = file();
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const clipboardData = { files: [screenshot, photo, new File(['text'], 'text.txt', { type: 'text/plain' })] } as unknown as DataTransfer;
    const result = imagesFromClipboard({ clipboardData }, new Date(2026, 0, 1, 9, 5));
    expect(result.map(f => f.name)).toEqual(['Zrzut ekranu 09:05', 'photo.jpg']);
    expect(result[0].size).toBe(screenshot.size);
    expect(imagesFromDrop({ dataTransfer: clipboardData })).toEqual([screenshot, photo]);
    expect(imagesFromClipboard({ clipboardData: null })).toEqual([]);
  });
  it('leaves text pastes alone but keeps screenshots and copied images', () => {
    const image = file();
    const clip = (types: string[]) => ({ clipboardData: { types, files: [image] } as unknown as DataTransfer });
    expect(imagesFromClipboard(clip(['Files']), new Date(2026, 0, 1, 9, 5)).map(f => f.name)).toEqual(['Zrzut ekranu 09:05']);
    expect(imagesFromClipboard(clip(['text/plain', 'Files']))).toEqual([]);
    expect(imagesFromClipboard(clip(['text/html', 'text/plain', 'Files']))).toEqual([]);
    expect(imagesFromClipboard(clip(['text/html', 'Files']))).toHaveLength(1);
  });
  it('falls back to DataTransfer items without duplicating files', () => {
    const image = file();
    const dataTransfer = { files: [], items: [{ kind: 'file', getAsFile: () => image }, { kind: 'string', getAsFile: () => null }] } as unknown as DataTransfer;
    expect(imagesFromDrop({ dataTransfer })).toEqual([image]);
  });
});

describe('canvas preparation', () => {
  function browser(output: Blob | null, fail = false) {
    const revoke = vi.fn();
    const encode = vi.fn((callback: (blob: Blob | null) => void) => callback(output));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: encode };
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke });
    vi.stubGlobal('Image', class { naturalWidth = 5120; naturalHeight = 2560; decode() { return fail ? Promise.reject(new Error('decode')) : Promise.resolve(); } });
    vi.stubGlobal('document', { createElement: () => canvas });
    return { revoke, encode, canvas };
  }
  it('encodes WebP at 0.85, with capped dimensions', async () => {
    const output = new Blob(['x'], { type: 'image/webp' });
    const { canvas, encode, revoke } = browser(output);
    const result = await compressAttachment(file());
    expect(result).toMatchObject({ blob: output, width: 2560, height: 1280, mime: 'image/webp' });
    expect(canvas.width).toBe(2560);
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.85);
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
  it('preserves original dimensions and MIME when compression is larger or unsupported', async () => {
    for (const output of [new Blob(['long output'], { type: 'image/webp' }), new Blob(['x'], { type: 'image/png' }), null]) {
      browser(output);
      const input = file();
      expect(await compressAttachment(input)).toMatchObject({ blob: input, width: 5120, height: 2560, mime: 'image/png' });
    }
  });
  it('passes GIF bytes through without canvas encoding', async () => {
    const { encode } = browser(null);
    const input = file('image/gif');
    expect((await compressAttachment(input)).blob).toBe(input);
    expect(encode).not.toHaveBeenCalled();
  });
  it('releases the object URL even when decode fails', async () => {
    const { revoke } = browser(null, true);
    await expect(compressAttachment(file())).rejects.toThrow();
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
