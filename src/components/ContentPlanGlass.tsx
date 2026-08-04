// Content Plan — współdzielone prymitywy wizualne skórki „Glass" (port 1:1 z
// `planner/src/components/shared.jsx` aplikacji źródłowej): glify platform,
// pastylka platformy, miniatura mediów z Dysku Google i pigułka statusu.
//
// Glify marek platform są INLINE SVG (nie lucide): to logotypy serwisów, nie
// ikony interfejsu — barrel `icons.ts` ich nie ma i mieć nie może. Rejestr jest
// kluczowany slugiem platformy ze słownika marki; nieznany slug dostaje
// pastylkę z inicjałem w kolorze platformy (słownik jest edytowalny, więc
// fallback musi istnieć).
import type { ReactNode } from 'react';
import type { ContentPlanMedia, ContentPlanPlatform, ContentPlanStatus } from '../types';
import { CONTENT_PLAN_STATUS_META } from '../contentplan/glassView';

const GLYPHS: Record<string, ReactNode> = {
  facebook: (
    <path d="M13.5 8.5H16V5.5h-2.5c-2 0-3.5 1.6-3.5 3.5v2.5H8v3h2v5.5h3V14.5h2.3l.5-3H13v-2c0-.5.4-1 .9-1Z" />
  ),
  instagram: (
    <>
      <rect
        x="4.5"
        y="4.5"
        width="15"
        height="15"
        rx="4.5"
        fill="none"
        strokeWidth="2"
        stroke="currentColor"
      />
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

/** Pastylka platformy: kolorowy kwadracik z glifem (albo inicjałem, gdy slug
 *  spoza rejestru) — czytelniejsza na małych kafelkach niż sam glif. */
export function CpPlatformChip({
  platform,
  size = 17,
}: {
  platform: ContentPlanPlatform;
  size?: number;
}) {
  const glyph = GLYPHS[platform.id];
  return (
    <span
      className="cp-plat-chip"
      title={platform.name}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: platform.color || 'var(--n2-lavender)',
      }}
    >
      {glyph !== undefined ? (
        <svg viewBox="0 0 24 24" width={size * 0.72} height={size * 0.72} fill="#fff" aria-hidden>
          {glyph}
        </svg>
      ) : (
        <span className="cp-plat-chip-initial" aria-hidden>
          {platform.name.slice(0, 1).toLocaleUpperCase('pl-PL')}
        </span>
      )}
      <span className="sr-only">{platform.name}</span>
    </span>
  );
}

/** Sam glif platformy w kolorze marki serwisu — wiersze rejestru. */
export function CpPlatformGlyph({
  platform,
  size = 14,
  mono = false,
}: {
  platform: ContentPlanPlatform;
  size?: number;
  mono?: boolean;
}) {
  const glyph = GLYPHS[platform.id];
  if (glyph === undefined) {
    return (
      <span
        className="cp-plat-dot"
        title={platform.name}
        style={{ width: size * 0.6, height: size * 0.6, background: platform.color || 'var(--n2-lavender)' }}
      >
        <span className="sr-only">{platform.name}</span>
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={mono ? 'currentColor' : platform.color || 'var(--n2-lavender)'}
      aria-label={platform.name}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {glyph}
    </svg>
  );
}

/**
 * Miniatura mediów kanału: obraz z Dysku Google przez publiczny endpoint
 * `drive.google.com/thumbnail` (parytet ze źródłem — rozmyte tło wypełnia
 * kadr, właściwy obraz jest w całości widoczny, nic nie jest ucinane).
 * Brak pliku => gradientowy placeholder. Wideo dostaje overlay z trójkątem.
 */
export function CpMediaThumb({
  media,
  className = '',
  aspectRatio,
}: {
  media: ContentPlanMedia | undefined;
  className?: string;
  aspectRatio?: string;
}) {
  const src =
    media !== undefined
      ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(media.fileId)}&sz=w640`
      : null;
  return (
    <div
      className={`cp-thumb ${className}`.trim()}
      style={aspectRatio !== undefined ? { aspectRatio } : undefined}
    >
      {src !== null && (
        <>
          <img
            src={src}
            alt=""
            aria-hidden
            loading="lazy"
            referrerPolicy="no-referrer"
            className="cp-thumb-blur"
          />
          <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="cp-thumb-img" />
        </>
      )}
      {media?.type === 'video' && (
        <span className="cp-thumb-play" aria-hidden>
          <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="#fff">
            <path d="M8.5 6.5v11l9-5.5-9-5.5Z" />
          </svg>
        </span>
      )}
    </div>
  );
}

/** Pigułka statusu: kolor z palety „Glass", tekst = nazwa statusu domeny. */
export function CpStatusPill({ status }: { status: ContentPlanStatus }) {
  const meta = CONTENT_PLAN_STATUS_META[status];
  return (
    <span className="cp-status-pill" style={{ '--sc': meta.color } as React.CSSProperties}>
      <i aria-hidden />
      {status}
    </span>
  );
}
