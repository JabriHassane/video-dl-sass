import crypto from 'node:crypto';
import { redis } from '../redis/client.js';
import { config } from '../config.js';

export const ACCESS_COOKIE = 'at';
export const REFRESH_COOKIE = 'rt';

/**
 * Deliberately NOT httpOnly, and deliberately empty of meaning: it holds
 * the string '1' and nothing else. The SPA cannot see the real tokens, so
 * on a cold page load it has no way to tell "signed out" from "access
 * token expired, refresh still good" — and would render a logged-out UI
 * to a logged-in user. This flag answers that one question without
 * carrying anything an attacker could use; forging it buys you a refresh
 * attempt that fails.
 */
export const SESSION_HINT_COOKIE = 'has_session';

/**
 * Refresh tokens are only ever sent to the endpoints that consume them.
 * A token that travels on every API call is a token that leaks in every
 * log, proxy trace and Referer — the access token is the one meant to be
 * chatty, and it is short-lived precisely so that it can be.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * Server-side session registry. A JWT is self-contained, which is what
 * makes it fast and what makes it dangerous: without this, a stolen token
 * stays valid until `exp` and "log out" is a purely cosmetic act on the
 * client. Every refresh token is registered here under its session id, so
 * logout, a forced sign-out, or reuse detection can actually kill it.
 *
 * Keyed by session rather than by token so that rotation keeps one stable
 * handle per device instead of accumulating one key per refresh.
 */
const sessionKey = (userId, sid) => `session:${userId}:${sid}`;

export function makeSessionId() {
  return crypto.randomUUID();
}

/**
 * Issues an access/refresh pair for a session. `jti` is the *current*
 * refresh token id — storing it is what makes rotation verifiable: a
 * refresh token presenting a stale jti is a replay, not a valid renewal.
 */
/**
 * An access token on its own, with no session registered in Redis.
 *
 * Used by the bearer flow (/api/auth/token), which issues no refresh
 * token: registering a 30-day session for a credential that cannot be
 * refreshed would leave an orphan key behind on every call. Such a token
 * is not revocable — it simply expires — which is why it is short-lived
 * and why obtaining one costs a full password check.
 */
export function issueAccessToken(fastify, user, sid = makeSessionId()) {
  return fastify.jwt.sign(
    { sub: user.id, role: user.role, sid, typ: 'access' },
    { expiresIn: config.accessTokenTtlSeconds },
  );
}

export async function issueTokens(fastify, user, sid = makeSessionId()) {
  const jti = crypto.randomUUID();

  const accessToken = issueAccessToken(fastify, user, sid);

  const refreshToken = fastify.jwt.sign(
    { sub: user.id, sid, jti, typ: 'refresh' },
    { expiresIn: config.refreshTokenTtlSeconds },
  );

  // TTL mirrors the token's own lifetime: the registry entry must not
  // outlive the credential it authorises, and must not expire before it
  // either (that would revoke a still-valid token at random).
  await redis.set(sessionKey(user.id, sid), jti, 'EX', config.refreshTokenTtlSeconds);

  return { accessToken, refreshToken, sid };
}

/**
 * Verifies a refresh token against the registry and rotates it.
 *
 * Reuse detection: if the presented jti is not the one on record, the
 * token has already been exchanged. Either it leaked and the thief is
 * replaying it, or the legitimate client is replaying it — both cases are
 * indistinguishable from here, so the safe response is to destroy the
 * whole session and force a real re-login.
 */
export async function rotateRefreshToken(fastify, rawToken) {
  let payload;
  try {
    payload = fastify.jwt.verify(rawToken);
  } catch {
    return { error: 'invalid_token' };
  }

  if (payload.typ !== 'refresh') return { error: 'invalid_token' };

  const key = sessionKey(payload.sub, payload.sid);
  const currentJti = await redis.get(key);

  if (!currentJti) return { error: 'revoked' };
  if (currentJti !== payload.jti) {
    await redis.del(key);
    return { error: 'reused' };
  }

  return { userId: payload.sub, sid: payload.sid };
}

/** Real revocation — the part `clearCookie` alone cannot provide. */
export async function revokeSession(userId, sid) {
  await redis.del(sessionKey(userId, sid));
}

/** Every device, e.g. after a password change or an account takeover. */
export async function revokeAllSessions(userId) {
  const keys = [];
  let cursor = '0';
  // SCAN rather than KEYS: this runs on a live server and KEYS blocks
  // Redis for the duration of a full keyspace walk.
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `session:${userId}:*`, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');

  if (keys.length > 0) await redis.del(...keys);
  return keys.length;
}

export function setAuthCookies(reply, { accessToken, refreshToken }) {
  const base = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
  };

  // Not localStorage: a token readable by JavaScript is a token that any
  // XSS on the page can exfiltrate. httpOnly keeps it out of reach of
  // page scripts entirely, and SameSite=strict covers the CSRF exposure
  // that cookie delivery would otherwise introduce.
  reply.setCookie(ACCESS_COOKIE, accessToken, {
    ...base,
    maxAge: config.accessTokenTtlSeconds,
  });

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTokenTtlSeconds,
  });

  reply.setCookie(SESSION_HINT_COOKIE, '1', {
    ...base,
    httpOnly: false, // readable by the SPA — see the constant's comment
    maxAge: config.refreshTokenTtlSeconds,
  });
}

export function clearAuthCookies(reply) {
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  reply.clearCookie(SESSION_HINT_COOKIE, { path: '/' });
}
