// Content Plan — panel szczegółów publikacji (port 1:1 layoutu „Studio" z
// `planner/src/components/PostDetail.jsx`): wysuwany z prawej panel z pigułką
// statusu, taby kanałów per platforma, treść, tagi, meta i pasek postępu
// workflow. CZYSTY RENDER — dane i akcje przychodzą z `ContentPlanPage`.
//
// To panel PODGLĄDU (read-only) — edycja otwiera pełny edytor (`?publikacja=`).
// Zamknięcie: klik w tło, Escape albo przycisk ✕ (fokus startuje na ✕ i wraca
// do karty przez powłokę strony — panel żyje krócej niż karta).
import { useEffect, useRef, useState } from 'react';
import type { ContentPlanBrand, ContentPlanPost } from '../types';
import {
  descriptionGroupId,
  formatCommentDate,
  platformFor,
  splitContentPlanTags,
} from '../contentplan/domain';
import {
  CONTENT_PLAN_STATUS_META,
  CONTENT_PLAN_STATUS_STEPS,
} from '../contentplan/glassView';
import { mediaAspectRatio } from '../contentplan/domain';
import { CpMediaThumb, CpPlatformChip, CpStatusPill } from './ContentPlanGlass';
import { Copy, Pencil, Trash2, X } from './icons';
import { formatShortWithWeekday } from '../utils/dates';

export function ContentPlanPostDetail({
  brand,
  post,
  copied,
  onClose,
  onEdit,
  onCopy,
  onDelete,
}: {
  brand: ContentPlanBrand;
  post: ContentPlanPost;
  copied: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [activeChannelId, setActiveChannelId] = useState(post.channels[0]?.id ?? '');
  const activeChannel =
    post.channels.find((channel) => channel.id === activeChannelId) ?? post.channels[0];

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const meta = CONTENT_PLAN_STATUS_META[post.status];
  const withMedia = post.channels.find((channel) => channel.media !== undefined);
  const tagsSource =
    activeChannel !== undefined && activeChannel.overrideTags ? activeChannel.tags : post.baseTags;
  const tags = splitContentPlanTags(tagsSource);
  const mainGroup = post.channels[0] !== undefined ? descriptionGroupId(post.channels[0]) : '';
  const lastComment = post.comments[post.comments.length - 1];

  return (
    <div
      className="cp-pd-overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <aside
        className="cp-pd"
        role="dialog"
        aria-modal="true"
        aria-label={`Publikacja: ${post.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cp-pd-head">
          <CpStatusPill status={post.status} />
          <div className="cp-pd-btns">
            <button type="button" className="cp-pd-action" onClick={onCopy} aria-pressed={copied}>
              <Copy size={13} aria-hidden /> {copied ? 'Skopiowano' : 'Kopiuj'}
            </button>
            <button type="button" className="cp-pd-action" onClick={onEdit} aria-haspopup="dialog">
              <Pencil size={13} aria-hidden /> Edytuj
            </button>
            <button
              type="button"
              className="cp-pd-close"
              onClick={onClose}
              aria-label="Zamknij podgląd"
              ref={closeRef}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        </div>

        <div className="cp-pd-brand">
          <span className="cp-pd-brand-logo" style={{ background: brand.accent || 'var(--n2-lavender)' }}>
            {brand.name.slice(0, 2).toLocaleUpperCase('pl-PL')}
          </span>
          {brand.name}
        </div>

        <h2 className="cp-pd-title">{post.title}</h2>
        <div className="cp-pd-when">
          {formatShortWithWeekday(post.date)}
          <span className="cp-pd-type">
            {post.format === '' ? 'Bez formatu' : post.format}
            {post.topic !== '' ? ` · ${post.topic}` : ''}
          </span>
        </div>

        <CpMediaThumb
          media={withMedia?.media}
          className="cp-pd-media"
          aspectRatio={mediaAspectRatio(withMedia, post.format)}
        />

        {post.channels.length > 1 && (
          <div className="cp-pd-tabs" role="tablist" aria-label="Kanały publikacji">
            {post.channels.map((channel) => {
              const platform = platformFor(brand, channel.platformId);
              if (!platform) return null;
              const isVariant = descriptionGroupId(channel) !== mainGroup;
              const on = channel.id === activeChannel?.id;
              return (
                <button
                  key={channel.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={`cp-pd-tab${on ? ' on' : ''}`}
                  onClick={() => setActiveChannelId(channel.id)}
                >
                  <CpPlatformChip platform={platform} size={16} />
                  {platform.name}
                  {isVariant && (
                    <span className="cp-pd-tab-mod" title="Osobny wariant opisu" aria-hidden>
                      ●
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {post.channels.length === 1 && activeChannel !== undefined && (
          <div className="cp-pd-single">
            {(() => {
              const platform = platformFor(brand, activeChannel.platformId);
              return platform ? (
                <>
                  <CpPlatformChip platform={platform} size={18} /> {platform.name}
                </>
              ) : null;
            })()}
          </div>
        )}

        <div className="cp-pd-copy">
          {activeChannel !== undefined && activeChannel.copy.trim() !== ''
            ? activeChannel.copy
            : 'Brak opisu publikacji.'}
        </div>

        {tags.length > 0 && (
          <div className="cp-pd-tags">
            {tags.map((tag) => (
              <span key={tag} className="cp-pd-tag">
                {tag}
              </span>
            ))}
          </div>
        )}

        {lastComment !== undefined && (
          <div className="cp-pd-comment">
            <div className="cp-pd-comment-head">
              Ostatni komentarz · {lastComment.author} · {formatCommentDate(lastComment.at)}
            </div>
            {lastComment.body}
          </div>
        )}

        <div className="cp-pd-meta">
          <div>
            <span>Widoczność</span>
            <b>{post.visibility === 'published' ? 'Udostępniona klientowi' : 'Robocza'}</b>
          </div>
          {post.topic !== '' && (
            <div>
              <span>Temat</span>
              <b>{post.topic}</b>
            </div>
          )}
          {withMedia?.media !== undefined && (
            <div>
              <span>Plik z Dysku</span>
              <b>
                <a
                  className="cp-pd-drive-link"
                  href={`https://drive.google.com/file/d/${encodeURIComponent(withMedia.media.fileId)}/view`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Otwórz w Dysku
                </a>
              </b>
            </div>
          )}
          <div>
            <span>Komentarze</span>
            <b>{post.comments.length}</b>
          </div>
        </div>

        <div className="cp-pd-flow">
          <div className="cp-pd-flow-track">
            <div
              className="cp-pd-flow-fill"
              style={{
                width: `${(meta.step / CONTENT_PLAN_STATUS_STEPS) * 100}%`,
                background: meta.color,
              }}
            />
          </div>
          <div className="cp-pd-flow-lbl">
            Etap {meta.step} z {CONTENT_PLAN_STATUS_STEPS} · {post.status}
          </div>
        </div>

        <button type="button" className="cp-pd-delete" onClick={onDelete}>
          <Trash2 size={14} aria-hidden /> Usuń publikację
        </button>
      </aside>
    </div>
  );
}
