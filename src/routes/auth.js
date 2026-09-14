import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { computeGuestFingerprint } from '../security/fingerprint.js';
import { getQuotaStatus, getGuestQuotaStatus } from '../services/quotaService.js';
import {
  issueTokens,
  issueAccessToken,
  rotateRefreshToken,
  revokeSession,
  setAuthCookies,
  clearAuthCookies,
  REFRESH_COOKIE,
} from '../security/tokens.js';

// A precomputed bcrypt hash of a random value, no matching plaintext.
// Compared against when the email doesn't exist, so login always pays
// the same bcrypt cost — otherwise "no such user" returns near-instantly
// while "wrong password" takes ~100ms, a timing oracle for account enumeration.
const DUMMY_HASH = '$2a$12$IiH6RxZcp91dVYLiXGw3r.tyqYGFPFwl.KlUW2IO38JT2dYBLJO6.';

export default async function authRoutes(fastify) {
  fastify.post(
    '/api/auth/register',
    {
      // Bounds account-creation spam / credential-stuffing signup abuse.
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const passwordHash = await bcrypt.hash(password, 12);

      try {
        const { rows } = await pool.query(
          `INSERT INTO users (email, password_hash, role)
           VALUES ($1, $2, 'FREE_USER')
           RETURNING id, email, role, created_at`,
          [email, passwordHash],
        );
        const user = rows[0];
        setAuthCookies(reply, await issueTokens(fastify, user));
        return user;
      } catch (err) {
        if (err.code === '23505') {
          reply.code(409);
          return { error: 'An account with this email already exists' };
        }
        throw err;
      }
    },
  );

  fastify.post(
    '/api/auth/login',
    {
      // Brute-force / credential-stuffing throttle. Deliberately tighter
      // than the global default, keyed per-IP like everything else here.
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const { rows } = await pool.query(
        'SELECT id, email, role, password_hash, status FROM users WHERE email = $1',
        [email],
      );
      const user = rows[0];

      // Always run bcrypt against *some* hash, even for an unknown email —
      // otherwise "no such user" returns instantly while "wrong password"
      // pays the full bcrypt cost, a timing side-channel that lets an
      // attacker enumerate registered emails by response time alone.
      const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !valid || user.status !== 'ACTIVE') {
        reply.code(401);
        return { error: 'Invalid email or password' };
      }

      setAuthCookies(reply, await issueTokens(fastify, user));
      return { id: user.id, email: user.email, role: user.role };
    },
  );

  /**
   * Issues a bare access token for clients that have no cookie jar: curl,
   * Postman, the Swagger UI "Authorize" box, server-to-server callers.
   *
   * It deliberately demands the password again rather than exchanging an
   * existing session, and deliberately returns no refresh token. That is
   * what keeps the browser flow safe: an XSS on the SPA cannot read the
   * httpOnly cookies, and cannot call this endpoint either without
   * credentials it does not have. Handing out a token from a live session
   * would have undone the whole point of httpOnly storage.
   */
  fastify.post(
    '/api/auth/token',
    {
      // Same throttle as login — this is a credential endpoint wearing a
      // different hat, and is equally attractive for password spraying.
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Get a bearer token (for curl / Postman / the Authorize button)',
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const { rows } = await pool.query(
        'SELECT id, email, role, password_hash, status FROM users WHERE email = $1',
        [email],
      );
      const user = rows[0];

      // Same constant-time posture as /login: always pay the bcrypt cost.
      const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !valid || user.status !== 'ACTIVE') {
        reply.code(401);
        return { error: 'Invalid email or password' };
      }

      return {
        tokenType: 'Bearer',
        accessToken: issueAccessToken(fastify, user),
        expiresIn: config.accessTokenTtlSeconds,
        role: user.role,
      };
    },
  );

  /**
   * Exchanges a refresh token for a fresh pair. This is also the only
   * point where `role` and `status` are re-read from the database, so it
   * doubles as the propagation point for bans and role changes.
   */
  fastify.post(
    '/api/auth/refresh',
    {
      // A refresh endpoint is an oracle for valid refresh tokens; throttle
      // it like a credential endpoint rather than a read.
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
      schema: { tags: ['auth'] },
    },
    async (req, reply) => {
      const raw = req.cookies?.[REFRESH_COOKIE];
      if (!raw) {
        reply.code(401);
        return { error: 'No refresh token', reason: 'no_session' };
      }

      const result = await rotateRefreshToken(fastify, raw);
      if (result.error) {
        clearAuthCookies(reply);
        reply.code(401);
        return {
          error: 'Session expired, please sign in again',
          // 'reused' means a refresh token was replayed after rotation:
          // the session has been destroyed server-side on purpose.
          reason: result.error,
        };
      }

      const { rows } = await pool.query(
        'SELECT id, email, role, status FROM users WHERE id = $1',
        [result.userId],
      );
      const user = rows[0];
      if (!user || user.status !== 'ACTIVE') {
        await revokeSession(result.userId, result.sid);
        clearAuthCookies(reply);
        reply.code(401);
        return { error: 'Account is no longer active', reason: 'inactive' };
      }

      // Same sid: rotation replaces the credential, not the session, so a
      // device keeps one stable handle for as long as it stays signed in.
      setAuthCookies(reply, await issueTokens(fastify, user, result.sid));
      return { id: user.id, email: user.email, role: user.role };
    },
  );

  fastify.post('/api/auth/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    // Drop the server-side registry entry first: clearing cookies only
    // asks the browser to forget the token, which does nothing about a
    // copy an attacker already holds.
    //
    // Fall back to the refresh token when the access token has already
    // expired — that is the common case for "I closed the tab yesterday
    // and clicked log out today", and it must still revoke the session
    // rather than silently leaving it alive for 30 days.
    let target = req.user?.sid ? { id: req.user.id, sid: req.user.sid } : null;

    if (!target && req.cookies?.[REFRESH_COOKIE]) {
      try {
        const payload = fastify.jwt.verify(req.cookies[REFRESH_COOKIE]);
        if (payload.typ === 'refresh') target = { id: payload.sub, sid: payload.sid };
      } catch {
        // Unverifiable token: nothing to revoke, just clear the cookies.
      }
    }

    if (target) await revokeSession(target.id, target.sid);
    clearAuthCookies(reply);
    return { ok: true };
  });

  fastify.get('/api/auth/me', { schema: { tags: ['auth'] } }, async (req) => {
    if (req.user) {
      const quota = await getQuotaStatus(req.user);
      return { authenticated: true, user: req.user, quota };
    }

    const fingerprint = computeGuestFingerprint(req, config.cookieSecret);
    const quota = await getGuestQuotaStatus(fingerprint);
    return { authenticated: false, user: null, quota };
  });
}
