// Content Plan — tryb kompaktowy „Rejestr" (port 1:1 z
// `planner/src/components/RegisterTable.jsx`): gęsta tabela publikacji z
// tygodniami jako separatorami i rozwijaniem szczegółów inline. CZYSTY RENDER —
// lista przychodzi już przefiltrowana (marka + status) z `ContentPlanPage`.
import { useState } from 'react';
import type { ContentPlanBrand, ContentPlanPost } from '../types';
import {
  contentPlanRegisterWeeks,
  CONTENT_PLAN_STATUS_META,
} from '../contentplan/glassView';
import { platformFor, splitContentPlanTags } from '../contentplan/domain';
import { CpMediaThumb, CpPlatformGlyph } from './ContentPlanGlass';
import { formatShortWithWeekday, isTodayStr, todayStr } from '../utils/dates';
import { Pencil } from './icons';

export function ContentPlanRegister({
  brands,
  posts,
  showBrand,
  onEdit,
}: {
  brands: readonly ContentPlanBrand[];
  posts: readonly ContentPlanPost[];
  showBrand: boolean;
  onEdit: (post: ContentPlanPost) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const weeks = contentPlanRegisterWeeks(posts);
  const today = todayStr();
  const cols = 5 + (showBrand ? 1 : 0);

  const brandOf = (post: ContentPlanPost) => brands.find((brand) => brand.id === post.brandId);

  return (
    <div className="cp-rg">
      <table className="cp-rg-table">
        <thead>
          <tr>
            <th scope="col">Data</th>
            {showBrand && <th scope="col">Marka</th>}
            <th scope="col">Tytuł</th>
            <th scope="col">Kanały</th>
            <th scope="col">Format</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => [
            <tr key={`w-${week.start}`} className="cp-rg-week-row">
              <td colSpan={cols}>
                Tydzień {week.label} · {week.posts.length}{' '}
                {week.posts.length === 1 ? 'publikacja' : 'publikacji'}
              </td>
            </tr>,
            ...week.posts.flatMap((post) => {
              const open = openId === post.id;
              const brand = brandOf(post);
              const statusMeta = CONTENT_PLAN_STATUS_META[post.status];
              const isPast = post.date < today;
              const withMedia = post.channels.find((channel) => channel.media !== undefined);
              const mainCopy =
                post.channels.find((channel) => channel.copy.trim() !== '')?.copy ?? '';
              const tags = splitContentPlanTags(post.baseTags);
              const rows = [
                <tr
                  key={post.id}
                  className={`cp-rg-row${open ? ' open' : ''}${isPast ? ' past' : ''}${isTodayStr(post.date) ? ' today' : ''}`}
                  onClick={() => setOpenId(open ? null : post.id)}
                >
                  {/* Kanoniczny format daty treści — z nazwą dnia (zgłoszenie
                      2026-08-07), zamiast gołego „07.08". */}
                  <td className="cp-rg-date">{formatShortWithWeekday(post.date)}</td>
                  {showBrand && (
                    <td className="cp-rg-brand">
                      <span
                        className="cp-rg-brand-dot"
                        style={{ background: brand?.accent || 'var(--n2-lavender)' }}
                        aria-hidden
                      />
                      {brand?.name ?? 'Marka usunięta'}
                    </td>
                  )}
                  <td className="cp-rg-title">
                    {/* Natywny button (nie semantyka na <tr>): rozwijanie musi
                        być osiągalne z klawiatury (Tab + Enter/Space) i nieść
                        aria-expanded; klik w resztę wiersza dalej działa
                        myszą (onClick na <tr>), stopPropagation chroni przed
                        podwójnym toggle. */}
                    <button
                      type="button"
                      className="cp-rg-title-btn"
                      aria-expanded={open}
                      {...(open ? { 'aria-controls': `cp-rg-expand-${post.id}` } : {})}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenId(open ? null : post.id);
                      }}
                    >
                      <span className="cp-rg-tree" aria-hidden>
                        {open ? '▾' : '▸'}
                      </span>{' '}
                      {post.title}
                    </button>
                  </td>
                  <td className="cp-rg-plats">
                    {brand !== undefined &&
                      post.channels.map((channel) => {
                        const platform = platformFor(brand, channel.platformId);
                        return platform ? (
                          <span key={channel.id}>
                            <CpPlatformGlyph platform={platform} size={14} />
                          </span>
                        ) : null;
                      })}
                  </td>
                  <td className="cp-rg-type">{post.format === '' ? 'brak' : post.format}</td>
                  <td>
                    <span
                      className="cp-rg-status"
                      style={{ '--sc': statusMeta.color } as React.CSSProperties}
                    >
                      {post.status}
                    </span>
                  </td>
                </tr>,
              ];
              if (open) {
                rows.push(
                  <tr key={`${post.id}-x`} id={`cp-rg-expand-${post.id}`} className="cp-rg-expand">
                    <td colSpan={cols}>
                      <div className="cp-rg-expand-box">
                        <CpMediaThumb media={withMedia?.media} className="cp-rg-thumb" />
                        <div className="cp-rg-expand-copy">
                          <p>{mainCopy === '' ? 'Brak opisu publikacji.' : mainCopy}</p>
                          {brand !== undefined &&
                            post.channels
                              .filter(
                                (channel) =>
                                  channel.copy.trim() !== '' && channel.copy !== mainCopy,
                              )
                              .map((channel) => {
                                const platform = platformFor(brand, channel.platformId);
                                return (
                                  <div key={channel.id} className="cp-rg-variant">
                                    <span className="cp-rg-variant-lbl">
                                      {platform && (
                                        <CpPlatformGlyph platform={platform} size={12} mono />
                                      )}
                                      wariant {platform?.name ?? channel.platformId}
                                    </span>
                                    <p>{channel.copy}</p>
                                  </div>
                                );
                              })}
                          {tags.length > 0 && (
                            <p className="cp-rg-expand-tags">{tags.join(' ')}</p>
                          )}
                          <div className="cp-rg-expand-meta">
                            <span>
                              Widoczność:{' '}
                              <b>{post.visibility === 'published' ? 'udostępniona' : 'robocza'}</b>
                            </span>
                            {post.topic !== '' && (
                              <span>
                                Temat: <b>{post.topic}</b>
                              </span>
                            )}
                            <span>
                              Komentarze: <b>{post.comments.length}</b>
                            </span>
                          </div>
                        </div>
                        <div className="cp-rg-expand-side">
                          <button
                            type="button"
                            className="cp-rg-edit"
                            aria-haspopup="dialog"
                            onClick={(event) => {
                              event.stopPropagation();
                              onEdit(post);
                            }}
                          >
                            <Pencil size={13} aria-hidden /> Edytuj
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>,
                );
              }
              return rows;
            }),
          ])}
        </tbody>
      </table>
      {weeks.length === 0 && (
        <div className="cp-rg-empty">Brak publikacji dla wybranych filtrów.</div>
      )}
    </div>
  );
}
