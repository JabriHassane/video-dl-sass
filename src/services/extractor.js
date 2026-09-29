import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { config } from '../config.js';

/**
 * Instagram, Facebook and (increasingly) TikTok refuse anonymous media
 * requests — yt-dlp returns "empty media response ... use --cookies".
 * The only way those platforms work at all is with a logged-in session.
 *
 * So cookies are supplied as a Netscape-format FILE mounted into the
 * container (YTDLP_COOKIES_FILE), never stored in the database and never
 * entered through the web UI: that keeps live session credentials out of
 * Postgres, out of backups, and out of any admin screen. Absent the file
 * everything still runs — those platforms simply fail with their own
 * "login required" error, which the API surfaces as a 422.
 *
 * Checked once at boot rather than per-spawn to avoid a stat() on the
 * hot path; restart the app after mounting or rotating the file.
 */
const cookiesFile =
  config.ytDlpCookiesFile && fs.existsSync(config.ytDlpCookiesFile)
    ? config.ytDlpCookiesFile
    : null;

if (config.ytDlpCookiesFile && !cookiesFile) {
  console.warn(
    `[extractor] YTDLP_COOKIES_FILE is set to "${config.ytDlpCookiesFile}" but no such file exists — ` +
      'login-gated platforms (Instagram, Facebook…) will fail.',
  );
}

/** Flags shared by every yt-dlp invocation (download and probe alike). */
function commonArgs() {
  return [
    '--no-warnings',
    '--no-cache-dir',
    // YouTube's internal API responses vary by which "client" yt-dlp
    // presents as, and which one currently returns usable progressive
    // formats shifts over time (YouTube-side rollouts/throttling). Try
    // a short list in order instead of hard-coding one that can go
    // stale — see https://github.com/yt-dlp/yt-dlp/issues/12482.
    //
    // android/web/tv only ever expose the single legacy progressive
    // "https" format (itag 18, capped at 360p) — every higher-quality
    // https format now requires a GVS PO token we don't have, so
    // yt-dlp silently drops them. mweb/web_safari/tv_simply expose the
    // SAME pre-muxed video+audio streams (both vcodec and acodec set,
    // exactly what availableHeights()/resolveFormat() require) up to
    // 1080p over HLS (m3u8) instead, which needs no PO token — yt-dlp's
    // bundled downloader (backed by ffmpeg) reassembles the HLS
    // segments into one stream on the fly, so this stays a single
    // pre-muxed output with no extra merging step on our side. Keeping
    // the original three first costs nothing (they just no-op past
    // itag 18) and preserves whatever they still cover on other
    // extractors that reuse this same arg list.
    '--extractor-args', 'youtube:player_client=android,web,tv,mweb,web_safari,tv_simply',
    ...(cookiesFile ? ['--cookies', cookiesFile] : []),
  ];
}

/**
 * Spawns yt-dlp with output forced to stdout ("-o -") so no bytes ever
 * touch a disk. Returns { stream, abort, done } where `stream` is the
 * process's stdout (a standard Readable — backpressure is handled by
 * whatever consumer .pipe()s it, e.g. Fastify's reply).
 *
 * `signal` (an AbortSignal) is wired to the child process so that a
 * client disconnect propagates into an immediate SIGTERM/SIGKILL of the
 * extractor, stopping upstream network consumption right away instead of
 * finishing the download into a void.
 */
export function extractToStream({ url, format, signal }) {
  const args = [
    url,
    '-f', format ?? 'best[height<=480]',
    '-o', '-', // write muxed output to stdout, never to a file
    '--no-part',
    '--no-continue',
    '--newline',
    '--no-playlist', // single-video extraction; playlist expansion happens one level up
    ...commonArgs(),
  ];

  const child = spawn(config.ytDlpBinary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    signal, // Node >=15.9: auto-kills the child when the signal aborts
  });

  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });

  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, killSignal) => {
      if (killSignal || signal?.aborted) {
        resolve({ aborted: true });
      } else if (code === 0) {
        resolve({ aborted: false });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderrTail}`));
      }
    });
  });

  function abort(reason) {
    if (!child.killed) child.kill('SIGTERM');
    // Escalate if the process ignores SIGTERM (network syscall stuck, etc.)
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 3000).unref();
  }

  return { stream: child.stdout, abort, done };
}

/**
 * Lightweight metadata probe (title, duration, playlist entries) without
 * downloading any media bytes — used to build the preview list and to
 * validate playlist size against the tier's max_playlist_items before
 * spending any bandwidth.
 *
 * `playlistEnd` bounds how many entries yt-dlp itself enumerates
 * (`--playlist-end`) — without it, pointing this at e.g. a channel's
 * /videos page makes yt-dlp walk its *entire* upload history before
 * returning anything, which is where the "playlist download hangs"
 * behavior came from. Always pass a finite cap for user-facing calls.
 */
export function probeMetadata(url, { playlistEnd, flat = true } = {}) {
  return new Promise((resolve, reject) => {
    const args = [url, '--dump-single-json'];
    if (flat) args.push('--flat-playlist');
    if (playlistEnd) args.push('--playlist-end', String(playlistEnd));
    args.push(...commonArgs());

    const child = spawn(config.ytDlpBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // Without this a slow/hanging extractor pins a request (and a
    // subprocess) open forever. Matters much more now that arbitrary
    // admin-added platforms can be probed, not just three known-good ones.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`probe timed out after ${config.probeTimeoutMs}ms`));
    }, config.probeTimeoutMs);

    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`probe failed: ${stderr.slice(-2000)}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Distinct video heights actually available for a URL, so the UI can offer
 * real choices instead of a fixed enum that may not exist on the platform
 * at hand (a 9:16 Instagram reel has nothing in common with a 4K YouTube
 * upload). Returns [] when the platform reports no height metadata at all,
 * which the caller treats as "offer the tier's default cap".
 */
export function availableHeights(meta) {
  const formats = Array.isArray(meta?.formats) ? meta.formats : [];
  const heights = formats
    // Progressive only — matches what resolveFormat can actually stream.
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
    .map((f) => f.height)
    .filter((h) => Number.isFinite(h) && h > 0);
  return [...new Set(heights)].sort((a, b) => a - b);
}
