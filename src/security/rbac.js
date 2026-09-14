import { config } from '../config.js';
import { computeGuestFingerprint } from './fingerprint.js';
import { getTierQuota, getActiveOverride } from '../services/quotaService.js';
import { checkAndIncrementQuota, currentMonthKey, secondsUntilNextMonth } from '../redis/client.js';

export class QuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExceededError';
    this.statusCode = 429;
  }
}

/**
 * RBAC + quota resolution cascade, exactly in this order:
 *
 *   1. ADMIN            -> unconditional bypass, no counters touched
 *   2. per-user override -> user_quota_overrides (if active)
 *   3. tier default      -> tier_quotas for the resolved role
 *   4. Redis counter      -> atomic check-and-increment for the period
 *
 * Attaches `req.quotaContext = { role, scope, limit, allowHd, maxResolution,
 * maxPlaylistItems }` for downstream handlers (e.g. to pick max resolution).
 */
export async function rbacQuotaMiddleware(req, reply) {
  const user = req.user; // set by an earlier auth plugin, or undefined for guests

  // --- 1. ADMIN bypass -------------------------------------------------
  if (user?.role === 'ADMIN') {
    req.quotaContext = {
      role: 'ADMIN',
      scope: `user:${user.id}`,
      limit: -1,
      allowHd: true,
      maxResolution: '4k',
      maxPlaylistItems: -1,
      bypassed: true,
    };
    return;
  }

  const role = user?.role ?? 'GUEST';
  const tierQuota = await getTierQuota(role);
  if (!tierQuota) {
    reply.code(500);
    throw new Error(`No tier_quotas row configured for role ${role}`);
  }

  let effectiveLimit = tierQuota.monthly_download_limit;
  let scope;
  let ttlSeconds;

  if (user) {
    // --- 2. Per-user override, if present and active ------------------
    const override = await getActiveOverride(user.id);
    if (override) {
      effectiveLimit = override.custom_monthly_limit;
    }
    scope = `quota:user:${user.id}:${currentMonthKey()}`;
    ttlSeconds = secondsUntilNextMonth();
  } else {
    // Guest: composite fingerprint identifies the "device" across requests.
    const fingerprint = computeGuestFingerprint(req, config.cookieSecret);
    req.guestFingerprint = fingerprint;
    scope = `quota:guest:${fingerprint}`;
    ttlSeconds = config.guestQuotaTtlSeconds; // fixed 30-day lock, not calendar-month
  }

  // --- 4. Atomic counter check ------------------------------------------
  const { allowed, count } = await checkAndIncrementQuota(scope, effectiveLimit, ttlSeconds);

  req.quotaContext = {
    role,
    scope,
    limit: effectiveLimit,
    allowHd: tierQuota.allow_hd,
    maxResolution: tierQuota.max_resolution,
    maxPlaylistItems: tierQuota.max_playlist_items,
    usedThisPeriod: count,
    bypassed: false,
  };

  if (!allowed) {
    throw new QuotaExceededError(
      `Monthly download limit reached (${effectiveLimit}) for role ${role}`,
    );
  }
}

export function requireRole(...allowedRoles) {
  return async function roleGuard(req, reply) {
    // 401 and 403 are not interchangeable here. "Your access token just
    // expired" is recoverable by calling /api/auth/refresh; "you are a
    // FREE_USER asking for an admin route" is not. Collapsing both into
    // 403 would make the client retry what it cannot fix, and give up on
    // what it could.
    if (!req.user) {
      reply.code(401);
      throw new Error('Unauthorized: authentication required');
    }
    if (!allowedRoles.includes(req.user.role)) {
      reply.code(403);
      throw new Error('Forbidden: insufficient role');
    }
  };
}
