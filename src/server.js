import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config.js';
import { ACCESS_COOKIE } from './security/tokens.js';
import { redis, loadLuaScripts } from './redis/client.js';
import { subscribeToQuotaInvalidation } from './services/quotaService.js';
import { subscribeToSiteContentInvalidation } from './services/siteContentService.js';
import { subscribeToPlatformInvalidation } from './services/platformService.js';
import registerAuth from './plugins/authenticate.js';
import authRoutes from './routes/auth.js';
import downloadRoutes from './routes/download.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';

if (config.cookieSecret === 'change-me-in-prod' && process.env.NODE_ENV === 'production') {
  throw new Error('COOKIE_SECRET is still the default value — refusing to start in production.');
}

// A predictable JWT signing key means anyone can mint an ADMIN token.
// This is the single worst failure mode of the whole auth scheme, so it
// fails at boot rather than silently in production.
if (config.jwtSecret === 'change-me-in-prod' && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is still the default value — refusing to start in production.');
}

const fastify = Fastify({ logger: true, trustProxy: config.trustedProxyCount });

await fastify.register(cors, {
  origin: config.frontendOrigins,
  credentials: true,
});

await fastify.register(helmet, {
  // A relaxed-but-real CSP: blocks third-party script/style/frame sources
  // (the actual XSS-mitigating part) while still allowing Swagger UI's
  // own inline bootstrap script to run at /docs.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
});

// Redis-backed so limits are shared across instances and survive restarts,
// instead of an in-memory counter that resets on every deploy.
await fastify.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
  redis,
  allowList: ['127.0.0.1'],
});

await fastify.register(cookie, { secret: config.cookieSecret });

// Tokens travel in httpOnly cookies rather than an Authorization header:
// the SPA never handles them in JavaScript, so an XSS cannot read them.
await fastify.register(jwt, {
  secret: config.jwtSecret,
  cookie: { cookieName: ACCESS_COOKIE, signed: false },
});

await fastify.register(swagger, {
  openapi: {
    info: {
      title: 'video-dl-saas API',
      version: '1.0.0',
      description: [
        'Zero-disk video/playlist download API — RBAC + quotas.',
        '',
        '### Authenticating in this page',
        '',
        '**Option 1 — session cookie (nothing to copy).** Run `POST /api/auth/login`',
        'below with an ADMIN account. The browser stores the httpOnly cookies and',
        'sends them on every later "Try it out" call, because these docs are served',
        'from the same origin as the API. Locked routes just start working.',
        '',
        '**Option 2 — bearer token (Authorize button).** Run `POST /api/auth/token`',
        'with the same credentials, copy the `accessToken` from the response, then',
        'click **Authorize** at the top right and paste it. Use this when you are',
        'driving the API from curl, Postman or your own client rather than a browser.',
        '',
        'Access tokens are short-lived (15 minutes by default). When calls start',
        'returning 401, run `POST /api/auth/refresh` (option 1) or fetch a new token',
        '(option 2). A 403 means the opposite — you are authenticated, but the',
        'account lacks the role.',
      ].join('\n'),
    },
    components: {
      securitySchemes: {
        // Declared so Swagger UI shows which routes are protected and
        // renders the Authorize dialog. cookieAuth is what the browser
        // actually uses; bearerAuth is for non-browser clients.
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: ACCESS_COOKIE,
          // Swagger UI renders an input for this, but browsers forbid
          // scripts from setting a Cookie header, so typing in it does
          // nothing. Say so here rather than let people fight it.
          description:
            'Set automatically by POST /api/auth/login — **leave the field below empty**. '
            + 'Browsers do not allow this page to set a cookie header, so the box has no effect; '
            + 'run the login endpoint instead and the cookie is stored for you. '
            + 'Use bearerAuth below if you want to paste a credential by hand.',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Paste the `accessToken` returned by POST /api/auth/token. Valid 15 minutes.',
        },
      },
    },
    tags: [
      { name: 'auth', description: 'Registration, login, session' },
      { name: 'download', description: 'Video and playlist streaming' },
      { name: 'admin', description: 'Quota administration (ADMIN only)' },
      { name: 'public', description: 'Marketing site endpoints (pricing, contact)' },
    ],
  },
});
// The spec itself is always generated (cheap, and route schemas need it),
// but /docs and /docs/json publish the complete API surface — every route,
// parameter and shape — to anyone who asks. That is free reconnaissance in
// production, so the UI is opt-in there via EXPOSE_DOCS=true.
if (config.exposeDocs) {
  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      // Send cookies on "Try it out" calls, so logging in through the
      // login endpoint on this page is enough to unlock the protected
      // routes — no token to copy around.
      withCredentials: true,
      // Keep a pasted bearer token across reloads; re-pasting it after
      // every refresh of the page is the main reason people give up on
      // testing protected endpoints from the docs.
      persistAuthorization: true,
    },
  });
}

await registerAuth(fastify);
await fastify.register(authRoutes);
await fastify.register(downloadRoutes);
await fastify.register(adminRoutes);
await fastify.register(publicRoutes);

fastify.get('/healthz', async () => ({ ok: true }));

// Same reasoning as /docs: a hand-written route index is still a route
// index. Kept as a developer convenience where the docs are exposed,
// reduced to a liveness banner everywhere else.
fastify.get('/', async () =>
  config.exposeDocs
    ? {
        service: 'video-dl-saas',
        docs: '/docs',
        endpoints: {
          health: 'GET /healthz',
          register: 'POST /api/auth/register',
          login: 'POST /api/auth/login',
          refresh: 'POST /api/auth/refresh',
          logout: 'POST /api/auth/logout',
          me: 'GET /api/auth/me',
          downloadVideo: 'GET /api/download/video?url=<source>&resolution=<480p|720p|1080p|4k>',
          downloadPlaylist: 'GET /api/download/playlist?url=<source>&resolution=<...>',
          adminUsers: 'GET /api/admin/users  (ADMIN only)',
          adminQuotas: 'GET/PATCH /api/admin/quotas[/:role]  (ADMIN only)',
          adminOverrides: 'POST/DELETE /api/admin/overrides[/:userId]  (ADMIN only)',
        },
      }
    : { service: 'video-dl-saas' },
);

await loadLuaScripts();
subscribeToQuotaInvalidation();
subscribeToSiteContentInvalidation();
subscribeToPlatformInvalidation();

fastify.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
