import crypto from 'node:crypto';
import { config } from '../config.js';
import { ACCESS_COOKIE } from '../security/tokens.js';

const GUEST_COOKIE = 'gsid';

/**
 * Populates `req.user` (undefined for anonymous/guest requests) from the
 * access JWT carried in an httpOnly cookie, and ensures every visitor —
 * including guests — carries a cookie for defense-in-depth correlation
 * alongside the HMAC fingerprint (see security/fingerprint.js).
 *
 * No database round-trip: `role` is read straight from the signed claims,
 * which is the point of a short-lived access token. The trade-off is that
 * a role change or a ban takes effect on the next refresh rather than the
 * next request — bounded by ACCESS_TOKEN_TTL (15 min by default), since
 * /api/auth/refresh re-reads the user row. For an immediate cut-off, call
 * revokeAllSessions() and the account is locked out at the next refresh.
 */
export default async function registerAuth(fastify) {
  fastify.addHook('onRequest', async (req, reply) => {
    // Cookie first: that is how the SPA authenticates, and it is the one
    // an attacker cannot read. The Authorization header is the path for
    // non-browser clients (curl, Postman, the Swagger UI Authorize box),
    // which have no cookie jar and must carry the token explicitly.
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const token = req.cookies?.[ACCESS_COOKIE] ?? bearer;

    if (token) {
      try {
        const payload = fastify.jwt.verify(token);
        // A refresh token presented where an access token belongs is not
        // a valid credential: it would otherwise let the long-lived token
        // act as a permanent session, defeating the short access TTL.
        if (payload.typ === 'access') {
          req.user = { id: payload.sub, role: payload.role, sid: payload.sid };
        }
      } catch {
        // Expired or tampered — treated as anonymous. The client is
        // expected to call /api/auth/refresh and retry.
      }
    }

    if (!req.user && !req.cookies?.[GUEST_COOKIE]) {
      reply.setCookie(GUEST_COOKIE, crypto.randomUUID(), {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'strict',
        signed: true,
        maxAge: config.guestQuotaTtlSeconds,
        path: '/',
      });
    }
  });
}
