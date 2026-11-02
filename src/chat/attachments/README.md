# Conversation image attachments (L2)

Import public APIs from `src/chat/attachments`. Existing type and constant names
are preserved. Components import `attachments.css` themselves. The application
must provide its existing `--n2-*` tokens, global modal CSS and Motion LazyMotion
provider (as it does for ModalFrame).

## Storage and queue

- `createAttachmentStorage(client, now?)`: injected authenticated SupabaseClient.
  Returns stable `upload`, `getSignedUrl`, `clearCache`. Memoize per client/session;
  recreate on auth identity change. No global client or public URLs.
- `upload(conversationId, file, onProgress)` returns
  `{ok:true, attachment:ChatAttachment}` or `{ok:false,error:string}`.
  Includes decoding/compression. Progress is coarse: 0 preparing, 0.2 uploading,
  1 complete; not bytes transferred. Upsert is disabled.
- `getSignedUrl(path, {download?:name, refresh?:boolean}?)` returns URL or null.
  Instance-scoped, capped in-memory cache, concurrent request deduplication,
  one-hour TTL and five-minute refresh margin. A thumbnail whose image fails
  to load (expired signature) signs again once with `refresh:true`, then shows
  a retry button. Download uses a separate signed URL with the storage
  download disposition rather than relying on cross-origin `download` alone.
- `useAttachmentQueue(conversationId, uploader)` returns `pending`, `attachments`
  (ready results), `allReady`, `error`, `addFiles(files)`, `remove(id)`, `retry(id)`,
  `clear()`, `onPaste(event)`, `onDrop(event)`. Native and React paste/drop events
  work. Empty queue has `allReady:true`; sending still requires body or an image.
  Any pending/error item makes `allReady:false`. Count includes in-flight files.
  Over-limit batches are rejected whole; invalid files are skipped with a Polish
  error. Decoding/upload is serialized to limit canvas memory. Conversation
  changes/unmount/clear invalidate stale results and revoke preview URLs.

```tsx
const storage = useMemo(() => createAttachmentStorage(client), [client]);
const queue = useAttachmentQueue(conversationId, storage.upload);
const depth = useRef(0);
const [dragging, setDragging] = useState(false);

// Container should have position: relative. Keep your text/mention handlers.
<div style={{ position: 'relative' }}
  onDragEnter={e => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault(); depth.current++; setDragging(true);
    }
  }}
  onDragOver={e => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    }
  }}
  onDragLeave={() => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  }}
  onDrop={e => {
    depth.current = 0; setDragging(false); queue.onDrop(e);
  }}>
  <AttachmentTray pending={queue.pending} error={queue.error}
    onRemove={queue.remove} onRetry={queue.retry} />
  <textarea onPaste={queue.onPaste} aria-label="Wiadomość" />
  <label>Dodaj obrazy
    <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif"
      onChange={e => {
        if (e.target.files) queue.addFiles(e.target.files);
        e.target.value = '';
      }} />
  </label>
  <DropZoneOverlay active={dragging} />
</div>

// On send: require queue.allReady && (body.trim() || queue.attachments.length).
// Send queue.attachments as messages.attachments. Clear ONLY after success.
// Render a persisted message:
<AttachmentGrid attachments={message.attachments} getSignedUrl={storage.getSignedUrl} />
```

## Components

- `AttachmentTray({pending,onRemove,onRetry,error?})`: preview list, progress
  rings, retry/remove controls, polite status announcements.
- `AttachmentGrid({attachments,getSignedUrl})`: one large image or two-column
  layout, up to four visible thumbnails, +n count. Intrinsic aspect boxes reserve
  layout; IntersectionObserver defers signing. Keyboard buttons open its own
  lightbox, which includes all images, including hidden ones. Failed thumbnails
  retry signing when clicked. Keep the getter reference stable.
- `ImageLightbox({attachments,getSignedUrl,initialIndex?,onClose})`: mount only
  when open. Full viewport, shared ModalFrame portal/trap/scroll lock/Escape,
  local arrow navigation (wraps), signed download link and filename alt text.
  Focus returns after shared shell inertness cleanup. MotionConfig respects
  reduced motion. Escape remains owned by the shared shell.
- `DropZoneOverlay({active})`: noninteractive visual hint. Caller owns container
  drag depth/reset and native file drop prevention; no window listeners.

## File helpers

`validateAttachmentFile` and `validateAttachmentCount` return a Polish error or
null. `attachmentTargetSize` preserves aspect, rounds to whole pixels, caps the
long edge at 2560 and does not upscale. `attachmentObjectPath` generates a UUID
path with extension from actual MIME. `imagesFromClipboard` renames `image.png`
to `Zrzut ekranu HH:MM`; drop keeps names. Non-images in clipboard/drop are
ignored, while unsupported image MIME types are rejected by queue validation.
`compressAttachment` uses canvas WebP at 0.85 and always releases its decode URL.
GIFs pass through byte-for-byte. If WebP is larger, unavailable or fails to
produce a blob, original bytes, MIME and dimensions are retained. Thus GIFs and
size-fallback originals can exceed 2560 px, deliberately honoring passthrough.
Pure imports can use `files.ts` / `types.ts` without loading React or Supabase.

## Verification and limits

- Unit: `npx vitest run src/chat/attachments` (pure logic and storage adapter).
- Browser: `zsh docs/karta-v2/heavy.sh node src/chat/attachments/attachments.e2e.mjs`
  starts its own Vite server on port 5182 and drives `attachments.fixture.html`
  (no app route, mock uploader that fails the first attempt for `retry*` names).
  Covers grid and +n, expired URL refresh, lightbox arrows with focus on the
  dialog, Escape and focus return, retry, remove, limit, paste, drop and stale
  uploads, at 390 px with reduced motion.

Hosted bucket/RLS behavior is untested against hosted DB. No migration is applied
by L2. Removal/clear prevents stale queue writes but cannot cancel an already
started Supabase upload. Uploaded objects removed before sending may remain
orphaned; retention/deletion is a coordinator/storage lifecycle concern. Client
MIME validation is UX validation, not content verification or authorization.
Wiki unchanged: existing primitive guidance remains accurate; edits are confined
to L2 ownership. Primary references: Radix Dialog
(https://www.radix-ui.com/primitives/docs/components/dialog) and WAI modal dialog
(https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Both use a dialog content
container, focus containment, Escape and return to trigger; Radix adds a portal
and overlay. L2 deliberately uses the existing ModalFrame for those behaviors,
adds only image navigation, and owns no scroll surface beyond its image area.
