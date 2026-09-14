import { pool } from '../db/pool.js';
import { redis, redisSub } from '../redis/client.js';

const CACHE_KEY = 'platforms:enabled';
const CACHE_TTL_SECONDS = 60;
export const PLATFORM_INVALIDATION_CHANNEL = 'platforms:invalidate';

/**
 * Flat list of every domain belonging to an *enabled* platform — this is
 * the live SSRF allowlist consulted on every URL validation, so it's kept
 * hot in Redis and invalidated via pub/sub the moment an admin changes it.
 *
 * A disabled platform disappears from this list immediately, which is the
 * point: disabling a platform must actually stop extractions for it, not
 * just hide it in the UI.
 */
export async function getAllowedDomains() {
  const cached = await redis.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const { rows } = await pool.query('SELECT domains FROM platforms WHERE enabled');
  const domains = rows.flatMap((r) => r.domains).map((d) => d.toLowerCase());

  await redis.set(CACHE_KEY, JSON.stringify(domains), 'EX', CACHE_TTL_SECONDS);
  return domains;
}

/** Full rows, for the admin table and the public "supported platforms" list. */
export async function listPlatforms({ onlyEnabled = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, slug, name, domains, enabled, requires_auth, notes, updated_at
       FROM platforms
      ${onlyEnabled ? 'WHERE enabled' : ''}
      ORDER BY name`,
  );
  return rows;
}

/**
 * The platform a hostname belongs to, or null. Used to turn a generic
 * extraction failure into a message that names the actual cause — an
 * Instagram reel failing because it needs a session is a different
 * problem from a deleted video, and the user can only act on the first.
 */
export async function platformForHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  const { rows } = await pool.query(
    'SELECT slug, name, requires_auth, domains FROM platforms WHERE enabled',
  );
  return (
    rows.find((row) =>
      row.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    ) ?? null
  );
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) return null;
  const cleaned = domains
    .map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  // Reject anything that isn't a plain hostname: no ports, no paths, no
  // wildcards, no IP literals. These strings become the allowlist itself,
  // so a malformed entry here is a security hole, not a cosmetic issue.
  const valid = cleaned.every((d) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d));
  return valid && cleaned.length > 0 ? [...new Set(cleaned)] : null;
}

export async function createPlatform({ slug, name, domains, enabled, requiresAuth, notes, adminUserId }) {
  const normalized = normalizeDomains(domains);
  if (!normalized) return { error: 'domains must be a non-empty list of plain hostnames' };

  try {
    const { rows } = await pool.query(
      `INSERT INTO platforms (slug, name, domains, enabled, requires_auth, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, slug, name, domains, enabled, requires_auth, notes, updated_at`,
      [slug, name, normalized, enabled ?? true, requiresAuth ?? false, notes ?? null, adminUserId],
    );
    await invalidate();
    return { platform: rows[0] };
  } catch (err) {
    if (err.code === '23505') return { error: `A platform with slug "${slug}" already exists` };
    throw err;
  }
}

export async function updatePlatform(id, patch, adminUserId) {
  let normalized;
  if (patch.domains !== undefined) {
    normalized = normalizeDomains(patch.domains);
    if (!normalized) return { error: 'domains must be a non-empty list of plain hostnames' };
  }

  const { rows } = await pool.query(
    `UPDATE platforms
        SET name          = COALESCE($2, name),
            domains       = COALESCE($3, domains),
            enabled       = COALESCE($4, enabled),
            requires_auth = COALESCE($5, requires_auth),
            notes         = COALESCE($6, notes),
            updated_by    = $7
      WHERE id = $1
      RETURNING id, slug, name, domains, enabled, requires_auth, notes, updated_at`,
    [
      id,
      patch.name ?? null,
      normalized ?? null,
      patch.enabled ?? null,
      patch.requiresAuth ?? null,
      patch.notes ?? null,
      adminUserId,
    ],
  );
  if (!rows[0]) return { error: 'Platform not found' };

  await invalidate();
  return { platform: rows[0] };
}

export async function deletePlatform(id) {
  const { rowCount } = await pool.query('DELETE FROM platforms WHERE id = $1', [id]);
  await invalidate();
  return rowCount > 0;
}

async function invalidate() {
  await redis.del(CACHE_KEY);
  await redis.publish(PLATFORM_INVALIDATION_CHANNEL, 'changed');
}

export function subscribeToPlatformInvalidation() {
  redisSub.subscribe(PLATFORM_INVALIDATION_CHANNEL);
  redisSub.on('message', async (channel) => {
    if (channel === PLATFORM_INVALIDATION_CHANNEL) {
      await redis.del(CACHE_KEY);
    }
  });
}
