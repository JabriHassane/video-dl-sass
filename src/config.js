export const config = {
  port: Number(process.env.PORT ?? 8080),

  pg: {
    connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/video_dl',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  cookieSecret: process.env.COOKIE_SECRET ?? 'change-me-in-prod',
  // Requires HTTPS to actually reach the browser. Set COOKIE_SECURE=false
  // only for local HTTP testing (e.g. docker-compose without a TLS proxy).
  cookieSecure: process.env.COOKIE_SECURE !== 'false',

  // Signing key for access/refresh JWTs. Deliberately separate from
  // COOKIE_SECRET: rotating it invalidates every session at once without
  // also breaking the signed guest cookie (and therefore guest quotas).
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-prod',

  // Short access token: the window during which a revoked/banned account
  // or a demoted role still passes. Refresh re-reads the DB, so this is
  // also the worst-case staleness of `role` and `status`.
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL ?? 900), // 15 min
  // Long refresh token, matching the previous session lifetime. Tracked
  // in Redis (see security/tokens.js) so logout genuinely revokes it.
  refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL ?? 30 * 24 * 60 * 60),

  // Swagger UI publishes the full API surface. Fine in dev, needless
  // disclosure in production — off unless explicitly re-enabled.
  exposeDocs: process.env.EXPOSE_DOCS
    ? process.env.EXPOSE_DOCS === 'true'
    : process.env.NODE_ENV !== 'production',

  // NOTE: the source-domain allowlist (SSRF guard) is NOT here — it lives
  // in the `platforms` table so admins can manage it without a redeploy.
  // See services/platformService.js and security/urlValidator.js.

  // Trust the first hop only when running behind a known reverse proxy
  // (Cloudflare / nginx). Never trust X-Forwarded-For blindly on the open net.
  trustedProxyCount: Number(process.env.TRUSTED_PROXY_COUNT ?? 1),

  // Origins allowed to call the API with credentials (the React SPA).
  frontendOrigins: (process.env.FRONTEND_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((o) => o.trim()),

  guestQuotaTtlSeconds: 30 * 24 * 60 * 60, // 30 days, matches spec's sliding lock
  quotaCacheTtlSeconds: 60, // tier_quotas Redis cache freshness

  ytDlpBinary: process.env.YTDLP_BIN ?? 'yt-dlp',
  maxConcurrentPlaylistStreams: 2,

  // Hard ceiling on how many entries a playlist probe ever enumerates,
  // regardless of the caller's tier (even an "unlimited" ADMIN/PREMIUM
  // playlist quota is still bounded by this for the preview/selection
  // step — pointing the source URL at a channel's full upload history
  // must not make yt-dlp walk thousands of entries in one probe).
  playlistProbeHardCap: Number(process.env.PLAYLIST_PROBE_HARD_CAP ?? 100),

  // Upper bound on a single metadata probe. Some platforms (or a wedged
  // extractor) can otherwise hang a request and its subprocess forever.
  probeTimeoutMs: Number(process.env.PROBE_TIMEOUT_MS ?? 45_000),

  // Optional Netscape-format cookies file, mounted read-only into the
  // container. Required for login-gated platforms (Instagram, Facebook,
  // often TikTok) — see the comment in services/extractor.js for why this
  // is a mounted file rather than a DB column or an admin-UI field.
  ytDlpCookiesFile: process.env.YTDLP_COOKIES_FILE ?? null,
};
