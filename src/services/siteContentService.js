import { pool } from '../db/pool.js';
import { redis, redisSub } from '../redis/client.js';

const CACHE_PREFIX = 'sitecontent:';
const CACHE_TTL_SECONDS = 300;
export const SITE_CONTENT_INVALIDATION_CHANNEL = 'sitecontent:invalidate';

const KNOWN_SECTIONS = ['landing', 'pricing', 'about', 'faq', 'contact', 'footer', 'cookies'];

/** Languages the public site can be served in. */
export const SUPPORTED_LANGS = ['fr', 'en'];
/** The language every other one falls back to, section by section. */
export const DEFAULT_LANG = 'fr';

export function normalizeLang(lang) {
  const candidate = String(lang ?? '').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(candidate) ? candidate : DEFAULT_LANG;
}

/**
 * All content for one language as a single { section: data } map — what
 * the public marketing pages fetch once on load. Cached in Redis (short
 * TTL as a safety net) and proactively invalidated via pub/sub the
 * instant an admin saves a change, same pattern as tier_quotas.
 *
 * Sections with no row in the requested language fall back to
 * DEFAULT_LANG, so adding a language does not require translating
 * everything before the site is usable — an untranslated page shows the
 * original copy rather than an empty shell.
 */
export async function getAllSiteContent(lang = DEFAULT_LANG) {
  const target = normalizeLang(lang);
  const cacheKey = `${CACHE_PREFIX}all:${target}`;

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Both languages in one query, default first, so the requested language
  // overwrites the fallback as we build the map.
  const { rows } = await pool.query(
    `SELECT section, lang, data
       FROM site_content
      WHERE lang IN ($1, $2)
      ORDER BY (lang = $1) ASC`,
    [target, DEFAULT_LANG],
  );

  const map = {};
  for (const row of rows) map[row.section] = row.data;

  await redis.set(cacheKey, JSON.stringify(map), 'EX', CACHE_TTL_SECONDS);
  return map;
}

/**
 * Every row, in every language, with updated_at/updated_by metadata — for
 * the admin editor only (the public map above deliberately stays lean and
 * cached). Not Redis-cached: this is a low-traffic admin-only read
 * straight from Postgres, and always reflects the latest write.
 *
 * Shaped as { lang: { section: row } } so the editor can present one tab
 * per language and show, per section, whether a translation exists at all.
 */
export async function getAllSiteContentWithMeta() {
  const { rows } = await pool.query(
    'SELECT section, lang, data, updated_at, updated_by FROM site_content',
  );

  const byLang = Object.fromEntries(SUPPORTED_LANGS.map((l) => [l, {}]));
  for (const row of rows) {
    byLang[row.lang] ??= {};
    byLang[row.lang][row.section] = row;
  }
  return { languages: SUPPORTED_LANGS, defaultLang: DEFAULT_LANG, content: byLang };
}

export async function updateSiteContent(section, lang, data, adminUserId) {
  if (!KNOWN_SECTIONS.includes(section)) return null;

  const target = normalizeLang(lang);
  // Rejecting an unsupported language rather than silently writing French
  // avoids an admin "translating" a page into a language the site never
  // serves and wondering why nothing changed.
  if (target !== String(lang ?? DEFAULT_LANG).slice(0, 2).toLowerCase()) return null;

  // Upsert, not update: a language's first translation of a section has
  // no row yet, and requiring a separate "create" step in the UI for that
  // is a distinction the admin should never have to think about.
  const { rows } = await pool.query(
    `INSERT INTO site_content (section, lang, data, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (section, lang)
       DO UPDATE SET data = EXCLUDED.data,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()
     RETURNING section, lang, data, updated_at, updated_by`,
    [section, target, JSON.stringify(data), adminUserId],
  );
  const updated = rows[0];
  if (!updated) return null;

  await invalidateAllLangs();
  await redis.publish(SITE_CONTENT_INVALIDATION_CHANNEL, `${section}:${target}`);

  return updated;
}

/**
 * Every language, not just the edited one: because untranslated sections
 * fall back to DEFAULT_LANG, editing the French copy changes what the
 * English site shows too. Dropping only the edited language's cache would
 * leave those fallbacks stale.
 */
async function invalidateAllLangs() {
  await redis.del(...SUPPORTED_LANGS.map((l) => `${CACHE_PREFIX}all:${l}`));
}

export function subscribeToSiteContentInvalidation() {
  redisSub.subscribe(SITE_CONTENT_INVALIDATION_CHANNEL);
  redisSub.on('message', async (channel) => {
    if (channel === SITE_CONTENT_INVALIDATION_CHANNEL) {
      await invalidateAllLangs();
    }
  });
}
