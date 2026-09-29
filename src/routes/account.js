import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { requireRole } from '../security/rbac.js';

/**
 * Self-service account management — email change, password change, and a
 * personal download history. Gated to real accounts only (not GUEST):
 * a guest has no row in `users` to manage.
 */
export default async function accountRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('FREE_USER', 'PREMIUM', 'ADMIN'));
  fastify.addHook('onRoute', (routeOptions) => {
    routeOptions.schema = {
      ...routeOptions.schema,
      tags: ['account'],
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    };
  });

  fastify.patch(
    '/api/account/profile',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        },
      },
    },
    async (req, reply) => {
      try {
        const { rows } = await pool.query(
          'UPDATE users SET email = $1 WHERE id = $2 RETURNING id, email, role',
          [req.body.email, req.user.id],
        );
        return rows[0];
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
    '/api/account/password',
    {
      // A password-change endpoint that verifies a current password is a
      // credential-guessing oracle just like login — throttle it the same.
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8 },
          },
        },
      },
    },
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body;
      const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      const valid = rows[0] && (await bcrypt.compare(currentPassword, rows[0].password_hash));
      if (!valid) {
        reply.code(401);
        return { error: 'Current password is incorrect' };
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
      return { ok: true };
    },
  );

  // Recent activity for the account page — same shape the admin overrides
  // table doesn't need, so this is intentionally separate from anything
  // in admin.js rather than reusing an admin-scoped query.
  fastify.get('/api/account/downloads', async (req) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { rows: items } = await pool.query(
      `SELECT id, source_url, media_type, resolution, bytes_transferred, completed, created_at
         FROM download_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [req.user.id, limit],
    );
    const { rows: [{ count }] } = await pool.query(
      'SELECT count(*) FROM download_logs WHERE user_id = $1',
      [req.user.id],
    );
    return { items, totalCount: Number(count) };
  });
}
