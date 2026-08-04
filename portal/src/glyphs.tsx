// Glify platform (logotypy serwisów, inline SVG — 1:1 z aplikacji źródłowej)
// i miniatura mediów z Dysku Google. Duplikacja z Hubem jest ŚWIADOMA: portal
// nie ciągnie bundla aplikacji wewnętrznej.
import type { ReactNode } from 'react';
import type { Channel, Platform } from './lib';
import { driveThumb } from './lib';

const GLYPHS: Record<string, ReactNode> = {
  facebook: (
    <path d="M13.5 8.5H16V5.5h-2.5c-2 0-3.5 1.6-3.5 3.5v2.5H8v3h2v5.5h3V14.5h2.3l.5-3H13v-2c0-.5.4-1 .9-1Z" />
  ),
  instagram: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="4.5" fill="none" strokeWidth="2" stroke="currentColor" />
      <circle cx="12" cy="12" r="3.4" fill="none" strokeWidth="2" stroke="currentColor" />
      <circle cx="16.7" cy="7.3" r="1.2" />
    </>
  ),
  tiktok: (
    <path d="M16.6 7.6c-1.3-.8-2.1-2.2-2.1-3.9h-2.9v11.5a2.5 2.5 0 1 1-2.5-2.5c.2 0 .5 0 .7.1V9.9c-.2 0-.5-.1-.7-.1a5.4 5.4 0 1 0 5.4 5.4V9.6c1 .7 2.1 1 3.3 1V7.8c-.4 0-.8-.1-1.2-.2Z" />
  ),
  linkedin: (
    <>
      <rect x="5" y="9.5" width="3" height="9.5" />
      <circle cx="6.5" cy="6.3" r="1.8" />
      <path d="M10.5 9.5h2.9v1.3c.5-.9 1.6-1.6 3-1.6 2.4 0 3.6 1.5 3.6 4.2V19h-3v-5c0-1.3-.5-2.1-1.6-2.1s-1.9.8-1.9 2.1v5h-3V9.5Z" />
    </>
  ),
  youtube: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="3.5" />
      <path d="M10.5 9.5v5l4.5-2.5-4.5-2.5Z" fill="#fff" />
    </>
  ),
  x: (
    <path d="M5 4.5h3.4l3.7 5 4-5H19l-5.5 6.8L19.5 19.5H16l-4-5.3-4.3 5.3H4.8l6-7.3L5 4.5Z" />
  ),
};

export function PlatformChip({ platform, size = 16 }: { platform: Platform; size?: number }) {
  const glyph = GLYPHS[platform.id];
  return (
    <span
      className="plat-chip"
      title={platform.name}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: platform.color || '#c496ff',
      }}
    >
      {glyph !== undefined ? (
        <svg viewBox="0 0 24 24" width={size * 0.72} height={size * 0.72} fill="#fff" aria-hidden>
          {glyph}
        </svg>
      ) : (
        <span aria-hidden style={{ fontSize: size * 0.55, fontWeight: 800 }}>
          {platform.name.slice(0, 1).toLocaleUpperCase('pl-PL')}
        </span>
      )}
      <span className="sr-only">{platform.name}</span>
    </span>
  );
}

export function MediaThumb({
  channel,
  className = '',
  aspectRatio,
  adaptive = false,
}: {
  channel: Channel | undefined;
  className?: string;
  aspectRatio?: string;
  adaptive?: boolean;
}) {
  const src = channel?.media_file_id ? driveThumb(channel.media_file_id) : null;
  return (
    <div
      className={`thumb ${className}`.trim()}
      style={aspectRatio !== undefined ? { aspectRatio } : undefined}
    >
      {src !== null && (
        <>
          <img src={src} alt="" aria-hidden loading="lazy" referrerPolicy="no-referrer" className="thumb-fill" />
          <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className={adaptive ? 'thumb-flow' : 'thumb-img'}
            onLoad={
              adaptive
                ? (event) => {
                    const box = event.currentTarget.parentElement;
                    if (box !== null) box.style.aspectRatio = 'auto';
                  }
                : undefined
            }
          />
        </>
      )}
      {channel?.media_type === 'video' && (
        <span className="thumb-play" aria-hidden>
          <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="#fff">
            <path d="M8.5 6.5v11l9-5.5-9-5.5Z" />
          </svg>
        </span>
      )}
    </div>
  );
}
