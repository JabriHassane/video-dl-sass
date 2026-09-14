import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Extracts the real public client IP, honoring only the number of trusted
 * proxy hops configured (Cloudflare / nginx in front). We take the entry
 * that OUR infra appended, never trusting arbitrary client-supplied hops.
 */
export function extractPublicIp(req) {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (cfConnectingIp) return normalizeIp(cfConnectingIp.trim());

  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim());
    // The Nth-from-the-right hop is the one our trusted proxy chain added.
    const index = Math.max(hops.length - config.trustedProxyCount, 0);
    return normalizeIp(hops[index] ?? hops[0]);
  }

  return normalizeIp(req.socket.remoteAddress ?? 'unknown');
}

function normalizeIp(ip) {
  // Strip IPv6-mapped-IPv4 prefix so ::ffff:1.2.3.4 and 1.2.3.4 collide.
  return ip.replace(/^::ffff:/, '').toLowerCase();
}

function normalizeUserAgent(ua = '') {
  // Collapse volatile minor-version noise, keep browser/OS family stable.
  return ua.toLowerCase().replace(/\d+(\.\d+)+/g, 'N').trim();
}

/**
 * Composite guest signature: HMAC-SHA256(ip + UA + client-side fingerprint).
 * The client fingerprint (Canvas/WebGL hash) must be sent by the front-end
 * as `X-Client-Fingerprint`; absence is treated as its own bucket so guests
 * without JS still get *a* fingerprint, just a weaker one.
 */
export function computeGuestFingerprint(req, hmacSecret) {
  const ip = extractPublicIp(req);
  const ua = normalizeUserAgent(req.headers['user-agent']);
  const clientFp = req.headers['x-client-fingerprint'] ?? 'no-js-fp';

  const payload = `${ip}|${ua}|${clientFp}`;
  return crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');
}
