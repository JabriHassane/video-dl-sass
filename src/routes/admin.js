import { requireRole } from '../security/rbac.js';
import { updateTierQuota, upsertOverride } from '../services/quotaService.js';
import {
  getAllSiteContentWithMeta,
  updateSiteContent,
  DEFAULT_LANG,
} from '../services/siteContentService.js';
import {
  listPlatforms,
  createPlatform,
  updatePlatform,
  deletePlatform,
} from '../services/platformService.js';
import { pool } from '../db/pool.js';

export default async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('ADMIN'));
  fastify.addHook('onRoute', (routeOptions) => {
    routeOptions.schema = {
      ...routeOptions.schema,
      tags: ['admin'],
      // Puts a padlock on every admin route in Swagger UI and makes the
      // Authorize dialog apply to them. Listing both schemes means "either
      // works" — cookie for the browser, bearer for everything else.
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    };
  });

  // For the override-assignment UI: pick a user by email/id.
  fastify.get('/api/admin/users', async (req) => {
    const { search } = req.query;
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.status, u.created_at,
              o.custom_monthly_limit AS override_limit, o.expires_at AS override_expires_at
         FROM users u
         LEFT JOIN user_quota_overrides o
           ON o.user_id = u.id AND (o.expires_at IS NULL OR o.expires_at > now())
        WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%')
        ORDER BY u.created_at DESC
        LIMIT 100`,
      [search ?? null],
    );
    return rows;
  });

  // Real-time dashboard: current tier config + today's usage snapshot.
  fastify.get('/api/admin/quotas', async () => {
    const { rows: tiers } = await pool.query('SELECT * FROM tier_quotas ORDER BY role');
    const { rows: usage } = await pool.query(`
      SELECT
        COALESCE(u.role::text, 'GUEST') AS role,
        count(*) FILTER (WHERE dl.created_at >= date_trunc('month', now())) AS downloads_this_month,
        count(*) FILTER (WHERE dl.created_at >= now() - interval '24 hours') AS downloads_last_24h
      FROM download_logs dl
      LEFT JOIN users u ON u.id = dl.user_id
      GROUP BY 1
    `);
    return { tiers, usage };
  });

  // Hot-edit a role's default quota. Cache invalidation is pushed via
  // Redis pub/sub inside updateTierQuota — every app instance drops its
  // local cache entry within one round trip, no restart needed.
  fastify.patch('/api/admin/quotas/:role', async (req, reply) => {
    const { role } = req.params;
    const allowedRoles = ['GUEST', 'FREE_USER', 'PREMIUM', 'ADMIN'];
    if (!allowedRoles.includes(role)) {
      reply.code(400);
      return { error: `Unknown role ${role}` };
    }

    const updated = await updateTierQuota(role, req.body, req.user.id);
    if (!updated) {
      reply.code(404);
      return { error: 'Role not found' };
    }
    return updated;
  });

  // Per-user override: arbitrary or unlimited (-1) monthly limit,
  // optionally time-boxed (promo, support goodwill, temp VIP access...).
  fastify.post('/api/admin/overrides', async (req, reply) => {
    const { userId, customMonthlyLimit, expiresAt, reason } = req.body;
    if (!userId || typeof customMonthlyLimit !== 'number') {
      reply.code(400);
      return { error: 'userId and customMonthlyLimit are required' };
    }

    const override = await upsertOverride({
      userId,
      customMonthlyLimit,
      expiresAt: expiresAt ?? null,
      reason,
      adminUserId: req.user.id,
    });
    return override;
  });

  fastify.delete('/api/admin/overrides/:userId', async (req) => {
    await pool.query('DELETE FROM user_quota_overrides WHERE user_id = $1', [req.params.userId]);
    return { ok: true };
  });

  // Messages submitted through the public "Contact us" page.
  fastify.get('/api/admin/contact-messages', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, email, subject, message, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 200',
    );
    return rows;
  });

  // Every piece of marketing copy — one JSON blob per site section.
  fastify.get('/api/admin/site-content', async () => getAllSiteContentWithMeta());

  // ---------------------------------------------------------------
  // Platforms — this list IS the SSRF allowlist (see platformService.js).
  // Adding a row here is what makes a new site downloadable; disabling one
  // stops extractions for it within one Redis round-trip, no redeploy.
  // ---------------------------------------------------------------
  fastify.get('/api/admin/platforms', async () => listPlatforms());

  fastify.post(
    '/api/admin/platforms',
    {
      schema: {
        body: {
          type: 'object',
          required: ['slug', 'name', 'domains'],
          properties: {
            slug: { type: 'string', pattern: '^[a-z0-9-]{2,40}$' },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            domains: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
            enabled: { type: 'boolean' },
            requiresAuth: { type: 'boolean' },
            notes: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const { platform, error } = await createPlatform({ ...req.body, adminUserId: req.user.id });
      if (error) {
        reply.code(400);
        return { error };
      }
      reply.code(201);
      return platform;
    },
  );

  fastify.patch(
    '/api/admin/platforms/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            domains: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
            enabled: { type: 'boolean' },
            requiresAuth: { type: 'boolean' },
            notes: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const { platform, error } = await updatePlatform(req.params.id, req.body, req.user.id);
      if (error) {
        reply.code(error === 'Platform not found' ? 404 : 400);
        return { error };
      }
      return platform;
    },
  );

  fastify.delete('/api/admin/platforms/:id', async (req, reply) => {
    const deleted = await deletePlatform(req.params.id);
    if (!deleted) {
      reply.code(404);
      return { error: 'Platform not found' };
    }
    return { ok: true };
  });

  // ?lang= picks which translation is written. Omitted means the default
  // language, which keeps every pre-i18n caller working unchanged.
  fastify.patch('/api/admin/site-content/:section', async (req, reply) => {
    const { section } = req.params;
    const lang = req.query.lang ?? DEFAULT_LANG;

    const updated = await updateSiteContent(section, lang, req.body, req.user.id);
    if (!updated) {
      reply.code(404);
      return {
        error: `Unknown site content section "${section}" or unsupported language "${lang}"`,
      };
    }
    return updated;
  });
}
