export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

/**
 * Whether the server last told us a session exists. The tokens themselves
 * are httpOnly and invisible here by design; this flag carries no secret
 * and grants nothing — it only decides whether attempting a refresh is
 * worth a round trip. The server is still the sole authority.
 */
export function hasSessionHint() {
  return document.cookie.split('; ').some((c) => c.startsWith('has_session='));
}

/**
 * In-flight refresh, shared by every caller. Without this, a page that
 * fires several requests at once on load would send several parallel
 * refreshes; each rotates the token, so all but one would be rejected as
 * a replay and the session would be destroyed by its own client.
 */
let refreshInFlight = null;

function refreshSession() {
  refreshInFlight ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function rawRequest(path, options) {
  return fetch(`${API_URL}${path}`, {
    credentials: 'include',
    // Only set Content-Type when there's an actual body — Fastify's JSON
    // parser rejects a request that declares 'application/json' but sends
    // an empty body (FST_ERR_CTP_EMPTY_JSON_BODY), which is exactly what a
    // bodyless POST like logout does if this header is applied unconditionally.
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    ...options,
  });
}

async function request(path, options = {}, { allowRetry = true } = {}) {
  let res = await rawRequest(path, options);

  // Access tokens are short-lived by design, so a 401 mid-session is the
  // expected steady state, not an error. Refresh once and replay. The
  // auth endpoints are excluded: retrying a failed login or a rejected
  // refresh is pointless and would double-count against their rate limits.
  if (res.status === 401 && allowRetry && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) {
      res = await rawRequest(path, options);
    }
  }

  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    const message = body?.error ?? `Request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    // Machine-readable cause (e.g. 'auth_required') so callers can react to
    // *why* it failed, not just show the text. Discarding it here would
    // force the UI to string-match error messages.
    error.reason = body?.reason ?? null;
    error.platform = body?.platform ?? null;
    throw error;
  }
  return body;
}

export const api = {
  me: () => request('/api/auth/me'),
  register: (email, password) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  refresh: () => request('/api/auth/refresh', { method: 'POST' }),

  adminUsers: (search = '') => request(`/api/admin/users?search=${encodeURIComponent(search)}`),
  adminQuotas: () => request('/api/admin/quotas'),
  adminUpdateTier: (role, patch) =>
    request(`/api/admin/quotas/${role}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminSetOverride: (payload) =>
    request('/api/admin/overrides', { method: 'POST', body: JSON.stringify(payload) }),
  adminDeleteOverride: (userId) => request(`/api/admin/overrides/${userId}`, { method: 'DELETE' }),

  previewPlaylist: (url) => request(`/api/playlist/preview?url=${encodeURIComponent(url)}`),
  mediaInfo: (url) => request(`/api/media/info?url=${encodeURIComponent(url)}`),

  platforms: () => request('/api/platforms'),
  adminPlatforms: () => request('/api/admin/platforms'),
  adminCreatePlatform: (payload) =>
    request('/api/admin/platforms', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdatePlatform: (id, patch) =>
    request(`/api/admin/platforms/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminDeletePlatform: (id) => request(`/api/admin/platforms/${id}`, { method: 'DELETE' }),

  pricing: () => request('/api/pricing'),
  sendContactMessage: (payload) => request('/api/contact', { method: 'POST', body: JSON.stringify(payload) }),
  adminContactMessages: () => request('/api/admin/contact-messages'),

  siteContent: (lang) => request(`/api/site-content?lang=${encodeURIComponent(lang ?? '')}`),
  languages: () => request('/api/languages'),
  adminSiteContent: () => request('/api/admin/site-content'),
  adminUpdateSiteContent: (section, lang, data) =>
    request(`/api/admin/site-content/${section}?lang=${encodeURIComponent(lang)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

/**
 * Download endpoints are plain browser navigations, not fetch() calls:
 * a top-level GET lets the browser stream the response straight to disk
 * (its own "Save As" pipeline) instead of buffering the whole file as a
 * JS Blob in page memory. The trade-off is that a quota/SSRF error (JSON)
 * renders as a page instead of a nice in-app toast — acceptable for a v1.
 */
export function buildDownloadUrl(kind, { url, resolution, select }) {
  const params = new URLSearchParams({ url });
  if (resolution) params.set('resolution', resolution);
  if (select) params.set('select', select.join(','));
  return `${API_URL}/api/download/${kind}?${params.toString()}`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
