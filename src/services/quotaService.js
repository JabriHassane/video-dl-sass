import { pool } from '../db/pool.js';
import {
  redis,
  redisSub,
  QUOTA_INVALIDATION_CHANNEL,
  peekQuotaCount,
  currentMonthKey,
} from '../redis/client.js';
import { config } from '../config.js';

const TIER_CACHE_PREFIX = 'tierquota:';

/**
 * Loads tier_quotas for a role, Redis-cached with a short TTL and
 * proactively invalidated on admin writes via pub/sub (so the TTL is
 * just a safety net, not the primary invalidation mechanism).
 */
export async function getTierQuota(role) {
  const cacheKey = TIER_CACHE_PREFIX + role;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const { rows } = await pool.query('SELECT * FROM tier_quotas WHERE role = $1', [role]);
  const quota = rows[0] ?? null;
  if (quota) {
    await redis.set(cacheKey, JSON.stringify(quota), 'EX', config.quotaCacheTtlSeconds);
  }
  return quota;
}

export async function updateTierQuota(role, patch, adminUserId) {
  const { rows } = await pool.query(
    `UPDATE tier_quotas
       SET monthly_download_limit = COALESCE($2, monthly_download_limit),
           max_playlist_items     = COALESCE($3, max_playlist_items),
           allow_hd               = COALESCE($4, allow_hd),
           max_resolution         = COALESCE($5, max_resolution),
           max_concurrent_streams = COALESCE($6, max_concurrent_streams),
           updated_by             = $7
     WHERE role = $1
     RETURNING *`,
    [
      role,
      patch.monthlyDownloadLimit,
      patch.maxPlaylistItems,
      patch.allowHd,
      patch.maxResolution,
      patch.maxConcurrentStreams,
      adminUserId,
    ],
  );

  // Invalidate everywhere immediately — every Fastify instance subscribes
  // to this channel and drops its local Redis cache entry on receipt.
  await redis.del(TIER_CACHE_PREFIX + role);
  await redis.publish(QUOTA_INVALIDATION_CHANNEL, role);

  return rows[0];
}

export function subscribeToQuotaInvalidation() {
  redisSub.subscribe(QUOTA_INVALIDATION_CHANNEL);
  redisSub.on('message', async (channel, role) => {
    if (channel === QUOTA_INVALIDATION_CHANNEL) {
      await redis.del(TIER_CACHE_PREFIX + role);
    }
  });
}

/**
 * Active override for a user, or null. NULL/absent expires_at = permanent.
 */
export async function getActiveOverride(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM user_quota_overrides
      WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertOverride({ userId, customMonthlyLimit, expiresAt, reason, adminUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO user_quota_overrides (user_id, custom_monthly_limit, expires_at, reason, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE
       SET custom_monthly_limit = EXCLUDED.custom_monthly_limit,
           expires_at           = EXCLUDED.expires_at,
           reason               = EXCLUDED.reason,
           created_by           = EXCLUDED.created_by,
           created_at           = now()
     RETURNING *`,
    [userId, customMonthlyLimit, expiresAt, reason, adminUserId],
  );
  return rows[0];
}

/**
 * Read-only status for the dashboard ("used X / Y this month"). Mirrors
 * the cascade in security/rbac.js but never touches the counter — a
 * status check must not itself consume quota.
 */
export async function getQuotaStatus(user) {
  if (user?.role === 'ADMIN') {
    return {
      role: 'ADMIN',
      limit: -1,
      used: 0,
      remaining: -1,
      allowHd: true,
      maxResolution: '4k',
      maxPlaylistItems: -1,
    };
  }

  const role = user?.role ?? 'GUEST';
  const tierQuota = await getTierQuota(role);

  let limit = tierQuota.monthly_download_limit;
  if (user) {
    const override = await getActiveOverride(user.id);
    if (override) limit = override.custom_monthly_limit;
  }

  const scope = user
    ? `quota:user:${user.id}:${currentMonthKey()}`
    : null; // guest status is looked up by the caller, which knows the fingerprint

  const used = scope ? await peekQuotaCount(scope) : null;

  return {
    role,
    limit,
    used,
    remaining: limit === -1 || used === null ? -1 : Math.max(limit - used, 0),
    allowHd: tierQuota.allow_hd,
    maxResolution: tierQuota.max_resolution,
    maxPlaylistItems: tierQuota.max_playlist_items,
  };
}

export async function getGuestQuotaStatus(fingerprint) {
  const tierQuota = await getTierQuota('GUEST');
  const used = await peekQuotaCount(`quota:guest:${fingerprint}`);
  return {
    role: 'GUEST',
    limit: tierQuota.monthly_download_limit,
    used,
    remaining: Math.max(tierQuota.monthly_download_limit - used, 0),
    allowHd: tierQuota.allow_hd,
    maxResolution: tierQuota.max_resolution,
    maxPlaylistItems: tierQuota.max_playlist_items,
  };
}
