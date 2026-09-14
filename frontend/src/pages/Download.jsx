import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import QuotaBadge from '../components/QuotaBadge.jsx';
import { api, buildDownloadUrl, formatDuration, hasSessionHint } from '../api.js';
import { platformStyle, detectPlatformSlug, slugFromExtractor } from '../platforms.js';
import { useT } from '../LanguageContext.jsx';

export default function Download() {
  const { quota, refresh } = useAuth();
  const t = useT();
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [quality, setQuality] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [platforms, setPlatforms] = useState([]);

  useEffect(() => {
    api.platforms().then(setPlatforms).catch(() => setPlatforms([]));
  }, []);

  // Tint the input as soon as the URL looks like a known platform — purely
  // a visual hint, the server still decides what's actually allowed.
  const typedSlug = useMemo(() => detectPlatformSlug(url), [url]);
  const resolvedSlug = info ? slugFromExtractor(info.extractor) ?? typedSlug : typedSlug;
  const brand = platformStyle(resolvedSlug);

  async function handleAnalyze(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setLoading(true);
    setInfo(null);
    try {
      const data = await api.mediaInfo(url.trim());
      setInfo(data);
      setQuality(data.qualities?.[data.qualities.length - 1]?.height ?? null);
      const cap = data.maxItems === -1 ? data.items.length : data.maxItems;
      setSelected(new Set(data.items.slice(0, Math.max(cap, 1)).map((_, i) => i)));
    } catch (err) {
      setError({ message: err.message, reason: err.reason });
    } finally {
      setLoading(false);
    }
  }

  function toggleItem(index) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
        return next;
      }
      const cap = info.maxItems;
      if (cap !== -1 && next.size >= cap) return prev; // role ceiling reached
      next.add(index);
      return next;
    });
  }

  async function startDownload() {
    if (!info) return;

    // The download is a top-level browser navigation, not a fetch, so it
    // never passes through the 401-and-retry path in api.js. With a short
    // access token, an expired one would simply be absent from the
    // request and the server would serve the user as an anonymous guest —
    // silently applying guest quota and 480p to a paying account. Renew
    // first so the navigation always carries a valid token.
    if (hasSessionHint()) await api.refresh().catch(() => null);

    const common = { url: url.trim(), resolution: quality ? String(quality) : undefined };
    const target =
      info.kind === 'playlist'
        ? buildDownloadUrl('playlist', { ...common, select: [...selected].sort((a, b) => a - b) })
        : buildDownloadUrl('video', common);
    window.location.href = target;
    setTimeout(refresh, 2000);
  }

  const capReached = info && info.maxItems !== -1 && selected.size >= info.maxItems;
  const canDownload = info && (info.kind === 'video' || selected.size > 0);

  return (
    <div className="card dl-card" style={{ '--brand': brand.color }}>
      <h1>{t('dl.title')}</h1>
      <QuotaBadge />

      <form onSubmit={handleAnalyze} className="dl-form">
        <label>
          {t('dl.label')}
          <div className="url-field">
            <span className="url-badge" aria-hidden="true">{brand.initials}</span>
            <input
              type="url"
              placeholder="https://www.instagram.com/reel/… · https://youtu.be/… · https://www.tiktok.com/…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setInfo(null);
                setError(null);
              }}
              required
            />
          </div>
        </label>

        <button type="submit" className="primary" disabled={loading}>
          {loading ? <span className="dots">{t('dl.analyzing')}</span> : t('dl.analyze')}
        </button>
      </form>

      {error && (
        <div className="error-box fade-in">
          <p className="error">{error.message}</p>
          {error.reason === 'auth_required' && (
            <p className="hint">
              {t('dl.authHint')} <code>YTDLP_COOKIES_FILE</code>.
            </p>
          )}
        </div>
      )}

      {info && (
        <div className="result fade-in">
          <div className="result-head">
            <span className="platform-chip">{brand.label}</span>
            <span className="kind-chip">
              {info.kind === 'playlist'
                ? t('dl.playlistCount', { n: info.items.length })
                : t('dl.video')}
            </span>
          </div>

          <h2 className="result-title">{info.title ?? t('dl.untitled')}</h2>

          {info.qualities?.length > 0 && (
            <div className="quality-row">
              <span className="quality-label">{t('dl.quality')}</span>
              {info.qualities.map((q) => (
                <button
                  key={q.height}
                  type="button"
                  className={`quality-pill ${quality === q.height ? 'active' : ''}`}
                  onClick={() => setQuality(q.height)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          {info.kind === 'playlist' && (
            <>
              <div className="list-head">
                <span>
                  {selected.size > 1
                    ? t('dl.selectedPlural', { n: selected.size })
                    : t('dl.selected', { n: selected.size })}
                  {info.maxItems !== -1 ? t('dl.maxForPlan', { n: info.maxItems }) : ''}
                </span>
                {info.truncated && <span className="hint">{t('dl.truncated')}</span>}
              </div>
              <ul className="video-list">
                {info.items.map((item, index) => (
                  <li
                    key={item.id ?? index}
                    className="video-item"
                    style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      disabled={!selected.has(index) && capReached}
                      onChange={() => toggleItem(index)}
                    />
                    {item.thumbnail && (
                      <img src={item.thumbnail} alt="" className="video-thumb" loading="lazy" />
                    )}
                    <span className="video-title">{item.title ?? item.id}</span>
                    <span className="video-duration">{formatDuration(item.durationSeconds)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button type="button" className="primary brand-btn" disabled={!canDownload} onClick={startDownload}>
            {info.kind === 'playlist'
              ? t('dl.downloadZip', { n: selected.size })
              : t('dl.downloadVideo')}
          </button>
        </div>
      )}

      {platforms.length > 0 && (
        <div className="supported">
          <span className="hint">
            {t('dl.supported')}
            {platforms.some((p) => p.requiresAuth) && (
              <> — <span className="auth-dot">●</span> {t('dl.needsSession')}</>
            )}
          </span>
          <div className="platform-tags">
            {platforms.map((p) => {
              const s = platformStyle(p.slug);
              return (
                <span
                  key={p.slug}
                  className={`platform-tag ${p.requiresAuth ? 'needs-auth' : ''}`}
                  style={{ '--tag': s.color }}
                  title={p.notes ?? ''}
                >
                  {p.name}
                  {/* Marked rather than hidden: the platform genuinely works,
                      but only once a session is configured server-side. */}
                  {p.requiresAuth && (
                    <span className="auth-dot" aria-label={t('dl.sessionRequired')}> ●</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
