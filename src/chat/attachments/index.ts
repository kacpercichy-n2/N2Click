export { CHAT_ATTACHMENT_BUCKET, CHAT_ATTACHMENTS_MAX, CHAT_ATTACHMENT_MAX_INPUT_BYTES } from './types';
export type { ChatAttachment, PendingAttachment } from './types';

export { ATTACHMENT_TYPES, validateAttachmentFile, validateAttachmentCount, attachmentTargetSize, attachmentObjectPath, compressAttachment, imagesFromClipboard, imagesFromDrop } from './files';
export type { PreparedAttachment } from './files';
export { createAttachmentStorage } from './storage';
export type { AttachmentUploader, AttachmentUploadResult, AttachmentUrlGetter } from './storage';
export { useAttachmentQueue } from './useAttachmentQueue';
export { AttachmentTray, AttachmentGrid, ImageLightbox, DropZoneOverlay } from './components';
export type { AttachmentTrayProps, AttachmentGridProps, ImageLightboxProps } from './components';
