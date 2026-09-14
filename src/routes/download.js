import { assertSafeSourceUrl, SsrfBlockedError } from '../security/urlValidator.js';
import { rbacQuotaMiddleware, QuotaExceededError } from '../security/rbac.js';
import { extractToStream, probeMetadata, availableHeights } from '../services/extractor.js';
import { streamPlaylistAsZip } from '../services/zipStream.js';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { computeGuestFingerprint } from '../security/fingerprint.js';
import { getQuotaStatus, getGuestQuotaStatus } from '../services/quotaService.js';
import { platformForHost } from '../services/platformService.js';

// Single source of truth for the label <-> pixel-height mapping, shared by
// the quality probe and resolveFormat so the UI can never offer a quality
// the download path would then reject.
const HEIGHT_BY_LABEL = { '480p': 480, '720p': 720, '1080p': 1080, '4k': 2160 };
const LABEL_BY_HEIGHT = { 480: '480p', 720: '720p', 1080: '1080p', 2160: '4k' };

function thumbnailFor(entry) {
  const thumbs = entry.thumbnails;
  return Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1].url : entry.thumbnail ?? null;
}

function toPreviewItem(entry) {
  return {
    id: entry.id,
    title: entry.title,
    durationSeconds: entry.duration ?? null,
    thumbnail: thumbnailFor(entry),
    url: entry.url ?? entry.webpage_url,
  };
}

async function peekQuota(req) {
  if (req.user) return getQuotaStatus(req.user);
  const fingerprint = computeGuestFingerprint(req, config.cookieSecret);
  return getGuestQuotaStatus(fingerprint);
}

// Runs BEFORE the quota counter is touched: an invalid/blocked URL must
// never burn a guest's 1-per-month allowance (or anyone else's quota).
async function validateUrlHook(req, reply) {
  const { url } = req.query;
  if (!url) {
    reply.code(400).send({ error: 'Missing "url" query parameter' });
    return reply; // returning the reply short-circuits the hook chain in Fastify
  }
  req.safeUrl = await assertSafeSourceUrl(url); // throws SsrfBlockedError -> mapped by setErrorHandler
}

export default async function downloadRoutes(fastify) {
  // ---------------------------------------------------------------
  // Universal link probe — the user pastes ANY supported link (an
  // Instagram/Facebook reel, a TikTok, a single video, a whole playlist)
  // and this says what it is, what qualities exist for it, and how many
  // items their role may take. One probe, no quota consumed, so the UI
  // never has to ask the user "is this a video or a playlist?".
  // ---------------------------------------------------------------
  fastify.get(
    '/api/media/info',
    {
      preHandler: [validateUrlHook],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['download'],
        summary: 'Identify any supported link and list its available qualities',
        querystring: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const quota = await peekQuota(req);
      const tierCeiling = HEIGHT_BY_LABEL[quota.allowHd ? quota.maxResolution ?? '1080p' : '480p'] ?? 480;

      let meta;
      try {
        meta = await probeMetadata(req.safeUrl.toString(), {
          playlistEnd: config.playlistProbeHardCap,
          // Non-flat so `formats` is populated — that's what quality
          // detection reads. Flat mode returns entries but no formats.
          flat: false,
        });
      } catch (err) {
        req.log.warn({ err: err.message }, 'media info probe failed');
        reply.code(422);

        // A login-gated platform failing is a different problem from a
        // deleted video, and only the first is actionable by the operator.
        // Name the real cause instead of one vague catch-all message.
        const platform = await platformForHost(req.safeUrl.hostname);
        if (platform?.requires_auth) {
          return {
            error: `${platform.name} n'autorise pas les requêtes anonymes : ce contenu nécessite une session connectée.`,
            reason: 'auth_required',
            platform: platform.slug,
          };
        }

        return {
          error:
            'Impossible de lire ce lien. Le contenu est peut-être privé, supprimé, ou indisponible.',
          reason: 'unavailable',
        };
      }

      const entries = Array.isArray(meta.entries) ? meta.entries.filter(Boolean) : null;
      const isPlaylist = Boolean(entries && entries.length > 1);

      if (isPlaylist && quota.maxPlaylistItems === 0) {
        reply.code(403);
        return { error: 'Les playlists ne sont pas disponibles sur votre offre' };
      }

      // Only what the tier actually permits is ever offered.
      const detected = availableHeights(isPlaylist ? entries[0] ?? {} : meta);
      const offered = detected.filter((h) => h <= tierCeiling);
      const qualities = (offered.length > 0 ? offered : [tierCeiling]).map((h) => ({
        height: h,
        label: LABEL_BY_HEIGHT[h] ?? `${h}p`,
      }));

      const items = (entries ?? [meta]).map(toPreviewItem);

      return {
        kind: isPlaylist ? 'playlist' : 'video',
        title: meta.title ?? null,
        extractor: meta.extractor_key ?? meta.extractor ?? null,
        qualities,
        // The per-role item cap the admin controls, surfaced so the UI can
        // enforce (and explain) it instead of failing at download time.
        maxItems: quota.maxPlaylistItems,
        items,
        truncated: items.length >= config.playlistProbeHardCap,
      };
    },
  );

  // ---------------------------------------------------------------
  // Playlist preview — lists the videos so the user can pick which ones
  // to actually download. Never touches the download quota counter, and
  // always bounds yt-dlp's own enumeration (config.playlistProbeHardCap):
  // pointing this at e.g. a channel's /videos page must not make the
  // probe walk thousands of entries before responding.
  // ---------------------------------------------------------------
  fastify.get(
    '/api/playlist/preview',
    {
      preHandler: [validateUrlHook],
      // Each call spawns a yt-dlp subprocess against an external site —
      // free (no quota consumed) but not free to run, so it gets its own
      // tighter cap instead of relying on the generic global limit.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['download'],
        summary: 'List a playlist\'s videos without downloading anything',
        querystring: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const quota = await peekQuota(req);
      if (quota.maxPlaylistItems === 0) {
        reply.code(403);
        return { error: 'Playlists are not available on your plan' };
      }

      const meta = await probeMetadata(req.safeUrl.toString(), {
        playlistEnd: config.playlistProbeHardCap,
      });
      const rawEntries = (meta.entries ?? [meta]).filter(Boolean);
      const items = rawEntries.map(toPreviewItem);

      return {
        title: meta.title ?? null,
        items,
        truncated: items.length >= config.playlistProbeHardCap,
        maxPlaylistItems: quota.maxPlaylistItems,
      };
    },
  );

  // ---------------------------------------------------------------
  // Single video — direct passthrough stream, zero disk, backpressure
  // handled natively by Node's stream .pipe() inside Fastify's reply.
  // ---------------------------------------------------------------
  fastify.get(
    '/api/download/video',
    {
      preHandler: [validateUrlHook, rbacQuotaMiddleware],
      // Defense-in-depth on top of the per-role quota: quota caps *how
      // many* downloads succeed per month, this caps *how fast* someone
      // can fire requests at the extractor subprocess pool per minute.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['download'],
        summary: 'Stream a single video, zero disk buffering',
        querystring: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'Source video page URL (allowlisted domains only)' },
            // A label ("720p") or a raw pixel height ("640") from the
            // per-link quality list. Always clamped to the tier ceiling
            // server-side, so a free-form value can't buy extra quality.
            resolution: { type: 'string', pattern: '^(480p|720p|1080p|4k|[0-9]{2,4})$' },
          },
        },
      },
    },
    async (req, reply) => {
    const { resolution } = req.query;
    const safeUrl = req.safeUrl;

    const { allowHd, maxResolution } = req.quotaContext;
    const format = resolveFormat(resolution, allowHd, maxResolution);

    // AbortController bridges "client closed the socket" to "kill the
    // extractor subprocess", so we stop pulling bytes from the source
    // the instant nobody is listening anymore.
    const abortController = new AbortController();
    req.raw.on('close', () => {
      if (!reply.raw.writableEnded) {
        abortController.abort('client_disconnect');
      }
    });

    const { stream, done } = extractToStream({ url: safeUrl.toString(), format, signal: abortController.signal });

    reply.raw.setHeader('Content-Type', 'video/mp4');
    reply.raw.setHeader('Content-Disposition', `attachment; filename="download.mp4"`);
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.setHeader('Transfer-Encoding', 'chunked'); // total size unknown ahead of stream

    let bytesTransferred = 0;
    stream.on('data', (chunk) => {
      bytesTransferred += chunk.length;
    });

    reply.hijack(); // we own the raw response now — Fastify won't try to also send a reply
    stream.pipe(reply.raw);

    let outcome;
    try {
      outcome = await done;
    } catch (err) {
      req.log.error({ err }, 'extraction failed');
      if (!reply.raw.headersSent) reply.raw.writeHead(502);
      reply.raw.end();
      outcome = { aborted: true };
    }

    await logDownload({
      req,
      sourceUrl: safeUrl.toString(),
      mediaType: 'VIDEO',
      bytesTransferred,
      completed: !outcome.aborted,
      abortReason: outcome.aborted ? 'client_disconnect_or_error' : null,
    });
  });

  // ---------------------------------------------------------------
  // Playlist — streamed ZIP, gated by max_playlist_items for the role.
  // ---------------------------------------------------------------
  fastify.get(
    '/api/download/playlist',
    {
      preHandler: [validateUrlHook, rbacQuotaMiddleware],
      // Tighter than the single-video limit: each call can spin up
      // multiple concurrent yt-dlp subprocesses (see zipStream.js).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['download'],
        summary: 'Stream a playlist as a ZIP, zero disk buffering',
        querystring: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'Source playlist URL (allowlisted domains only)' },
            // A label ("720p") or a raw pixel height ("640") from the
            // per-link quality list. Always clamped to the tier ceiling
            // server-side, so a free-form value can't buy extra quality.
            resolution: { type: 'string', pattern: '^(480p|720p|1080p|4k|[0-9]{2,4})$' },
            select: {
              type: 'string',
              description:
                'Comma-separated 0-based indices from /api/playlist/preview to download only those videos. Omit to download the whole (capped) playlist.',
            },
          },
        },
      },
    },
    async (req, reply) => {
    const { resolution, select } = req.query;
    const safeUrl = req.safeUrl;

    const { maxPlaylistItems, allowHd, maxResolution } = req.quotaContext;
    if (maxPlaylistItems === 0) {
      reply.code(403);
      return { error: 'Playlists are not available on your plan' };
    }

    // Same cap as the preview endpoint, so indices from a prior preview
    // call line up with this probe's ordering.
    const meta = await probeMetadata(safeUrl.toString(), { playlistEnd: config.playlistProbeHardCap });
    const rawEntries = (meta.entries ?? [meta]).filter(Boolean);
    let items = rawEntries.map((e) => ({ id: e.id, title: e.title, url: e.url ?? e.webpage_url }));

    if (select) {
      const indices = select.split(',').map((s) => Number(s.trim()));
      if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= items.length)) {
        reply.code(400);
        return { error: 'Invalid "select" indices for this playlist' };
      }
      items = indices.map((i) => items[i]);
    }

    if (maxPlaylistItems !== -1 && items.length > maxPlaylistItems) {
      reply.code(403);
      return {
        error: `Requested ${items.length} items, your plan allows a maximum of ${maxPlaylistItems} per playlist download`,
      };
    }

    const format = resolveFormat(resolution, allowHd, maxResolution);

    const abortController = new AbortController();
    req.raw.on('close', () => {
      if (!reply.raw.writableEnded) abortController.abort('client_disconnect');
    });

    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader('Content-Disposition', `attachment; filename="playlist.zip"`);
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.setHeader('Transfer-Encoding', 'chunked');

    reply.hijack();

    let aborted = false;
    try {
      await streamPlaylistAsZip({
        items,
        format,
        outputStream: reply.raw,
        signal: abortController.signal,
        maxItems: maxPlaylistItems,
      });
    } catch (err) {
      req.log.error({ err }, 'playlist zip streaming failed');
      aborted = true;
    } finally {
      reply.raw.end();
    }

    await logDownload({
      req,
      sourceUrl: safeUrl.toString(),
      mediaType: 'PLAYLIST_ZIP',
      bytesTransferred: null,
      completed: !aborted,
      abortReason: aborted ? 'client_disconnect_or_error' : null,
    });
  });

  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof SsrfBlockedError) {
      reply.code(400).send({ error: err.message });
      return;
    }
    if (err instanceof QuotaExceededError) {
      reply.code(429).send({ error: err.message });
      return;
    }
    req.log.error(err);
    reply.code(500).send({ error: 'Internal error' });
  });
}

/**
 * `requestedResolution` is either a label ("720p") or a raw pixel height
 * ("640") coming from the quality list that /api/media/info detected for
 * this specific link. Both are clamped to the tier's own ceiling, so a
 * hand-crafted request can never buy a higher quality than the role allows.
 */
function resolveFormat(requestedResolution, allowHd, maxResolution) {
  const tierCeiling = HEIGHT_BY_LABEL[allowHd ? maxResolution ?? '1080p' : '480p'] ?? 480;

  const requested =
    HEIGHT_BY_LABEL[requestedResolution] ??
    (Number.isFinite(Number(requestedResolution)) ? Number(requestedResolution) : null);

  const height = requested ? Math.min(requested, tierCeiling) : tierCeiling;
  // Deliberately progressive-only (single pre-muxed stream): muxing
  // separate video+audio tracks live into a stdout pipe via ffmpeg was
  // tested and hangs indefinitely in this environment (ffmpeg can't
  // reliably mux two concurrent network-fed inputs into a single pipe
  // output here).
  //
  // Two-step fallback, both bounded by the tier cap:
  //   1. best[height<=N]  — strict, used whenever the platform reports height
  //   2. best[height<=?N] — the "?" makes the comparison optional, so formats
  //      that simply don't declare a height still match. Short-form video
  //      (Instagram/Facebook/TikTok reels) frequently omits it, and without
  //      this the whole extraction fails with "Requested format is not
  //      available" even though a perfectly good stream exists.
  // Never falls through to a bare "best", which would silently exceed the cap.
  return `best[height<=${height}]/best[height<=?${height}]`;
}

async function logDownload({ req, sourceUrl, mediaType, bytesTransferred, completed, abortReason }) {
  try {
    await pool.query(
      `INSERT INTO download_logs
         (user_id, guest_fingerprint_hash, source_url, media_type, bytes_transferred, completed, abort_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.id ?? null,
        req.guestFingerprint ?? null,
        sourceUrl,
        mediaType,
        bytesTransferred ?? 0,
        completed,
        abortReason,
      ],
    );
  } catch (err) {
    req.log.error({ err }, 'failed to write download_logs entry');
  }
}
