// Portal klienta N2 Content Planu — logowanie + widok planu z perspektywy
// klienta (port widoku „Portal klienta" z aplikacji źródłowej planner/):
// hero z licznikiem akceptów, bento ze statystykami, oś czasu publikacji
// z rozwijanym szczegółem i akcjami Akceptuję / Zgłoś uwagę, tryb kompaktowy
// oraz podgląd „jak na telefonie". Marki przypina baza (brand_members):
// jedna marka = od razu jej widok, kilka = chipy z multi-zaznaczeniem,
// żeby dało się oglądać plan kilku marek naraz.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  brandInitials,
  clientStatus,
  dayLabel,
  fetchBrands,
  fetchPosts,
  mediaRatio,
  MONTHS_NOM,
  sendReview,
  supabase,
  todayIso,
  type Brand,
  type Post,
} from './lib';
import { MediaThumb, PlatformChip } from './glyphs';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!booted) return <div className="boot" aria-hidden />;
  return session === null ? <Login /> : <Portal onLogout={() => void supabase.auth.signOut()} />;
}

// ---- Logowanie ----------------------------------------------------------------

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError('Nie udało się zalogować. Sprawdź e-mail i hasło.');
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <span className="login-mark" aria-hidden />
        <h1>Plan publikacji</h1>
        <p className="login-sub">Portal klienta N2 Media</p>
        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            autoComplete="email"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Hasło</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error !== null && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Logowanie…' : 'Zaloguj się'}
        </button>
        <p className="login-foot">
          Problem z dostępem? Napisz do swojej opiekunki w N2 Media.
        </p>
      </form>
    </div>
  );
}

// ---- Portal ---------------------------------------------------------------------

function Portal({ onLogout }: { onLogout: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'timeline' | 'register'>('timeline');
  const [openId, setOpenId] = useState<string | null>(null);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Post | null>(null);
  const today = todayIso();

  const reload = useCallback(async (initial: boolean) => {
    try {
      const [brandRows, postRows] = await Promise.all([fetchBrands(), fetchPosts()]);
      setBrands(brandRows);
      setPosts(postRows);
      if (initial) setSelected(new Set(brandRows.slice(0, 1).map((b) => b.id)));
      setLoadError(null);
    } catch {
      setLoadError('Nie udało się pobrać planu publikacji. Odśwież stronę.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(true);
  }, [reload]);

  const toggleBrand = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (next.size === 1) return current; // zawsze co najmniej jedna marka
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const activeBrands = brands.filter((b) => selected.has(b.id));
  const multiBrand = activeBrands.length > 1;
  const visible = useMemo(
    () =>
      posts
        .filter((p) => selected.has(p.brand_id))
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pl')),
    [posts, selected],
  );

  const pending = visible.filter((p) => p.status === 'Do akceptacji');
  const published = visible.filter((p) => p.status === 'Opublikowano').length;
  const videos = visible.filter((p) =>
    p.post_channels.some((c) => c.media_type === 'video'),
  ).length;

  const platformCounts = useMemo(() => {
    const counts = new Map<string, { platform: Brand['platforms'][number]; count: number }>();
    for (const post of visible) {
      const brand = brands.find((b) => b.id === post.brand_id);
      if (!brand) continue;
      const seen = new Set<string>();
      for (const channel of post.post_channels) {
        if (seen.has(channel.platform_id)) continue;
        seen.add(channel.platform_id);
        const platform = brand.platforms.find((pl) => pl.id === channel.platform_id);
        if (!platform) continue;
        const row = counts.get(platform.id);
        if (row) row.count += 1;
        else counts.set(platform.id, { platform, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [visible, brands]);

  const days = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const post of visible) {
      const bucket = map.get(post.date);
      if (bucket) bucket.push(post);
      else map.set(post.date, [post]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const brandOf = (post: Post) => brands.find((b) => b.id === post.brand_id);

  const review = async (post: Post, decision: 'Akceptacja' | 'Uwagi', comment?: string) => {
    setReviewBusy(post.id);
    try {
      await sendReview(post.id, decision, comment);
      setCommentFor(null);
      setCommentText('');
      await reload(false);
    } catch {
      setLoadError('Nie udało się zapisać decyzji. Spróbuj ponownie.');
    } finally {
      setReviewBusy(null);
    }
  };

  const now = new Date();
  const heroMonth = `${MONTHS_NOM[now.getMonth()]} ${now.getFullYear()}`;

  if (loading) return <div className="boot" aria-hidden />;

  let todayShown = false;

  return (
    <div className="cv-shell">
      <div className="cv-scroll">
        <div className="cv-inner">
          <header className="cv-top">
            <div className="cv-brands" role="group" aria-label="Twoje marki">
              {brands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  className={`cv-brand-chip${selected.has(brand.id) ? ' on' : ''}`}
                  aria-pressed={selected.has(brand.id)}
                  onClick={() => toggleBrand(brand.id)}
                >
                  <span
                    className="cv-brand-logo"
                    style={{ background: brand.accent || '#c496ff' }}
                    aria-hidden
                  >
                    {brandInitials(brand.name)}
                  </span>
                  {brand.name}
                </button>
              ))}
            </div>
            <button type="button" className="cv-logout" onClick={onLogout}>
              Wyloguj
            </button>
          </header>

          <header className="cv-hero">
            <div className="cv-hero-left">
              <div className="cv-brand-line">
                {activeBrands.map((b) => b.name).join(' + ')}
              </div>
              <h1>
                Plan publikacji
                <br />
                <em>{heroMonth}</em>
              </h1>
            </div>
            {pending.length > 0 ? (
              <div className="cv-todo">
                <div className="cv-todo-num">{pending.length}</div>
                <div className="cv-todo-txt">
                  {pending.length === 1 ? 'post czeka' : 'posty czekają'} na Twoją akceptację
                </div>
              </div>
            ) : (
              <div className="cv-todo done">
                <div className="cv-todo-num">✓</div>
                <div className="cv-todo-txt">
                  <b>Wszystko przejrzane!</b>
                  <br />
                  Nic nie czeka na Twoją decyzję.
                </div>
              </div>
            )}
          </header>

          {loadError !== null && (
            <p className="cv-error" role="alert">
              {loadError}
            </p>
          )}

          <section className="cv-bento">
            <div className="cv-tile cv-tile-contract">
              <div className="cv-tile-big">{visible.length}</div>
              <div className="cv-tile-lbl">
                {visible.length === 1 ? 'publikacja w planie' : 'publikacji w planie'}
              </div>
            </div>
            <div className="cv-tile">
              <div className="cv-tile-big">{published}</div>
              <div className="cv-tile-lbl">już opublikowane ✓</div>
            </div>
            <div className="cv-tile cv-tile-platforms">
              <div className="cv-tile-lbl">gdzie publikujemy</div>
              <div className="cv-plat-rows">
                {platformCounts.map(({ platform, count }) => (
                  <div key={platform.id} className="cv-plat-row">
                    <PlatformChip platform={platform} size={20} />
                    <span className="cv-plat-name">{platform.name}</span>
                    <span className="cv-plat-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="cv-tile">
              <div className="cv-tile-lbl">rodzaje treści</div>
              <div className="cv-mix-row">🖼 {visible.length - videos} grafik</div>
              <div className="cv-mix-row">🎬 {videos} wideo</div>
            </div>
          </section>

          <div className="cv-modebar">
            <h2 className="cv-modebar-title">Publikacje</h2>
            <div className="cv-mode" role="tablist" aria-label="Tryb listy publikacji">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'timeline'}
                className={`cv-mode-btn${mode === 'timeline' ? ' on' : ''}`}
                onClick={() => setMode('timeline')}
              >
                ▤ Oś czasu
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={`cv-mode-btn${mode === 'register' ? ' on' : ''}`}
                onClick={() => setMode('register')}
              >
                ☰ Kompaktowo
              </button>
            </div>
          </div>

          {mode === 'timeline' && (
            <div className="cv-timeline">
              {days.length === 0 && (
                <p className="cv-empty">Brak publikacji w planie wybranych marek.</p>
              )}
              {days.map(([iso, dayPosts]) => {
                const label = dayLabel(iso);
                const isPast = iso < today;
                const isToday = iso === today;
                const showTodayMarker = !todayShown && iso >= today;
                if (showTodayMarker) todayShown = true;
                return (
                  <div key={iso}>
                    {showTodayMarker && (
                      <div className="cv-now">
                        <span>DZIŚ · {dayLabel(today).long}</span>
                      </div>
                    )}
                    <section className={`cv-day${isPast ? ' past' : ''}${isToday ? ' today' : ''}`}>
                      <div className="cv-day-col">
                        <div className="cv-day-num">{label.num}</div>
                        <div className="cv-day-dow">{label.dow}</div>
                      </div>
                      <div className="cv-day-posts">
                        {dayPosts.map((post) => {
                          const brand = brandOf(post);
                          const open = openId === post.id;
                          const status = clientStatus(post.status);
                          const mainChannel =
                            post.post_channels.find((c) => c.media_file_id !== null) ??
                            post.post_channels[0];
                          const copy =
                            post.post_channels.find((c) => c.copy.trim() !== '')?.copy ?? '';
                          const tags = mainChannel?.override_tags
                            ? mainChannel.tags
                            : post.base_tags;
                          return (
                            <article
                              key={post.id}
                              className={`cv-post${open ? ' open' : ''} k-${status.kind}`}
                            >
                              <button
                                type="button"
                                className="cv-post-head"
                                onClick={() => setOpenId(open ? null : post.id)}
                              >
                                <MediaThumb channel={mainChannel} className="cv-post-thumb" />
                                <div className="cv-post-main">
                                  <div className="cv-post-meta">
                                    {multiBrand && brand !== undefined && (
                                      <span
                                        className="cv-post-brand"
                                        style={{ background: brand.accent || '#c496ff' }}
                                        title={brand.name}
                                      >
                                        {brandInitials(brand.name)}
                                      </span>
                                    )}
                                    {brand !== undefined &&
                                      [...new Set(post.post_channels.map((c) => c.platform_id))].map(
                                        (platformId) => {
                                          const platform = brand.platforms.find(
                                            (pl) => pl.id === platformId,
                                          );
                                          return platform ? (
                                            <PlatformChip
                                              key={platformId}
                                              platform={platform}
                                              size={16}
                                            />
                                          ) : null;
                                        },
                                      )}
                                    <span className="cv-post-type">{post.format}</span>
                                  </div>
                                  <h3 className="cv-post-title">{post.title}</h3>
                                  {!open && copy !== '' && (
                                    <p className="cv-post-excerpt">{copy}</p>
                                  )}
                                </div>
                                <div className="cv-post-side">
                                  <span className={`cv-status s-${status.kind}`}>
                                    {status.label}
                                  </span>
                                </div>
                              </button>

                              {open && (
                                <div className="cv-detail">
                                  <div className="cv-detail-grid">
                                    <button
                                      type="button"
                                      className="cv-detail-media-btn"
                                      title="Zobacz podgląd jak na telefonie"
                                      onClick={() => setPreview(post)}
                                    >
                                      <MediaThumb
                                        channel={mainChannel}
                                        className="cv-detail-media"
                                        aspectRatio={mediaRatio(mainChannel, post.format)}
                                        adaptive
                                      />
                                      <span className="cv-detail-zoom">🔍 podgląd</span>
                                    </button>
                                    <div className="cv-detail-info">
                                      <p className="cv-detail-copy">
                                        {copy === '' ? 'Opis w przygotowaniu.' : copy}
                                      </p>
                                      {tags.length > 0 && (
                                        <div className="cv-tags">
                                          {tags.map((tag) => (
                                            <span key={tag}>{tag}</span>
                                          ))}
                                        </div>
                                      )}
                                      {post.status === 'Do akceptacji' && (
                                        <div className="cv-actions">
                                          <button
                                            type="button"
                                            className="cv-btn-approve"
                                            disabled={reviewBusy === post.id}
                                            onClick={() => void review(post, 'Akceptacja')}
                                          >
                                            ✓ Akceptuję
                                          </button>
                                          <button
                                            type="button"
                                            className="cv-btn-comment"
                                            onClick={() => {
                                              setCommentFor(post.id);
                                              setCommentText('');
                                            }}
                                          >
                                            Zgłoś uwagę
                                          </button>
                                        </div>
                                      )}
                                      {post.status === 'Akceptacja' && (
                                        <p className="cv-approved-note">
                                          ✓ Zaakceptowano — dziękujemy!
                                        </p>
                                      )}
                                      {commentFor === post.id && (
                                        <div className="cv-comment-box">
                                          <textarea
                                            autoFocus
                                            placeholder="Napisz zwykłym językiem, co zmienić…"
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                          />
                                          <div className="cv-comment-actions">
                                            <button
                                              type="button"
                                              className="cv-btn-send"
                                              disabled={
                                                commentText.trim() === '' ||
                                                reviewBusy === post.id
                                              }
                                              onClick={() =>
                                                void review(post, 'Uwagi', commentText.trim())
                                              }
                                            >
                                              Wyślij uwagę
                                            </button>
                                            <button
                                              type="button"
                                              className="cv-btn-cancel"
                                              onClick={() => setCommentFor(null)}
                                            >
                                              Anuluj
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                );
              })}
            </div>
          )}

          {mode === 'register' && (
            <div className="rg">
              <table className="rg-table">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    {multiBrand && <th scope="col">Marka</th>}
                    <th scope="col">Tytuł</th>
                    <th scope="col">Kanały</th>
                    <th scope="col">Format</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((post) => {
                    const brand = brandOf(post);
                    const status = clientStatus(post.status);
                    return (
                      <tr key={post.id} className={post.date < today ? 'past' : ''}>
                        <td className="rg-date">
                          {post.date.slice(8)}.{post.date.slice(5, 7)}
                        </td>
                        {multiBrand && (
                          <td className="rg-brand">
                            <span
                              className="rg-brand-dot"
                              style={{ background: brand?.accent || '#c496ff' }}
                              aria-hidden
                            />
                            {brand?.name ?? ''}
                          </td>
                        )}
                        <td className="rg-title">{post.title}</td>
                        <td className="rg-plats">
                          {brand !== undefined &&
                            [...new Set(post.post_channels.map((c) => c.platform_id))].map(
                              (platformId) => {
                                const platform = brand.platforms.find(
                                  (pl) => pl.id === platformId,
                                );
                                return platform ? (
                                  <PlatformChip key={platformId} platform={platform} size={14} />
                                ) : null;
                              },
                            )}
                        </td>
                        <td className="rg-type">{post.format}</td>
                        <td>
                          <span className={`cv-status s-${status.kind}`}>{status.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length === 0 && (
                <p className="cv-empty">Brak publikacji w planie wybranych marek.</p>
              )}
            </div>
          )}

          <footer className="cv-foot">
            Masz pytania? Napisz do swojej opiekunki w N2 Media.
            <br />
            Ten adres jest bezpieczny i zawsze aktualny.
          </footer>
        </div>
      </div>

      {preview !== null && (
        <div className="cv-overlay" role="presentation" onClick={() => setPreview(null)}>
          <div
            className="cv-preview"
            role="dialog"
            aria-modal="true"
            aria-label={`Podgląd: ${preview.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="cv-preview-close"
              aria-label="Zamknij podgląd"
              onClick={() => setPreview(null)}
            >
              ✕
            </button>
            {(() => {
              const brand = brandOf(preview);
              const channel =
                preview.post_channels.find((c) => c.media_file_id !== null) ??
                preview.post_channels[0];
              const copy =
                preview.post_channels.find((c) => c.copy.trim() !== '')?.copy ?? '';
              const handle = brand?.contact !== '' ? brand?.contact : brand?.name;
              return (
                <>
                  <div className="cv-preview-head">
                    <span
                      className="cv-preview-avatar"
                      style={{ background: brand?.accent || '#c496ff' }}
                      aria-hidden
                    >
                      {brand !== undefined ? brandInitials(brand.name) : '??'}
                    </span>
                    <div>
                      <b>{handle}</b>
                      <span>
                        {brand !== undefined
                          ? [...new Set(preview.post_channels.map((c) => c.platform_id))]
                              .map(
                                (id) => brand.platforms.find((pl) => pl.id === id)?.name ?? id,
                              )
                              .join(' + ')
                          : ''}
                      </span>
                    </div>
                  </div>
                  <MediaThumb
                    channel={channel}
                    className="cv-preview-media"
                    aspectRatio={mediaRatio(channel, preview.format)}
                  />
                  <div className="cv-preview-caption">
                    <b>{handle}</b> {copy}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
