import { pool } from '../db/pool.js';
import { getTierQuota } from '../services/quotaService.js';
import {
  getAllSiteContent,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
} from '../services/siteContentService.js';
import { listPlatforms } from '../services/platformService.js';

export default async function publicRoutes(fastify) {
  fastify.addHook('onRoute', (routeOptions) => {
    routeOptions.schema = { ...routeOptions.schema, tags: ['public'] };
  });

  // Live tier data for the marketing pricing page — pulled from the same
  // source the RBAC middleware enforces, so the pricing page can never
  // drift out of sync with what a signed-up user actually gets.
  fastify.get('/api/pricing', async () => {
    const [free, premium] = await Promise.all([getTierQuota('FREE_USER'), getTierQuota('PREMIUM')]);
    return { free, premium };
  });

  // Every string displayed on the marketing pages (landing, pricing copy,
  // about, faq, contact, footer) — admin-editable, see /api/admin/site-content.
  // ?lang= selects the translation; unknown or missing values fall back to
  // the default language rather than erroring, so a bad link still renders.
  fastify.get(
    '/api/site-content',
    {
      schema: {
        tags: ['public'],
        querystring: {
          type: 'object',
          properties: { lang: { type: 'string', maxLength: 10 } },
        },
      },
    },
    async (req) => getAllSiteContent(req.query.lang),
  );

  // Lets the client discover what it can switch to instead of hardcoding
  // a list that drifts from what the server actually serves.
  fastify.get('/api/languages', async () => ({
    languages: SUPPORTED_LANGS,
    defaultLang: DEFAULT_LANG,
  }));

  // Supported sources, so the app and the marketing pages can list them
  // instead of hardcoding names that drift from what's actually enabled.
  // Only enabled rows, and only the fields a visitor needs.
  fastify.get('/api/platforms', async () => {
    const rows = await listPlatforms({ onlyEnabled: true });
    return rows.map(({ slug, name, notes, requires_auth }) => ({
      slug,
      name,
      notes,
      requiresAuth: requires_auth,
    }));
  });

  fastify.post(
    '/api/contact',
    {
      // Cheap to spam otherwise — no auth, writes to the DB on every call.
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'message'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            email: { type: 'string', format: 'email' },
            subject: { type: 'string', maxLength: 200 },
            message: { type: 'string', minLength: 1, maxLength: 5000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { name, email, subject, message } = req.body;
      await pool.query(
        `INSERT INTO contact_messages (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
        [name, email, subject ?? null, message],
      );
      reply.code(201);
      return { ok: true };
    },
  );
}
