import Redis from 'ioredis';
import { config } from '../config.js';

// Command connection (GET/SET/EVALSHA/INCR...)
export const redis = new Redis(config.redis.url);

// Dedicated connection for pub/sub — ioredis puts a connection that calls
// SUBSCRIBE into a different mode, it can no longer run normal commands.
export const redisSub = new Redis(config.redis.url);

export const QUOTA_INVALIDATION_CHANNEL = 'quota:invalidate';

/**
 * Atomic "check-then-increment" against a monthly counter.
 * Returns { allowed, remaining } without a race between GET and INCR.
 *
 * KEYS[1] = counter key (e.g. quota:user:<id>:2026-09)
 * ARGV[1] = limit (-1 means unlimited)
 * ARGV[2] = seconds until key should expire (end of month, +buffer)
 */
const CHECK_AND_INCR_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if limit >= 0 and current >= limit then
  return {0, current}
end
local new = redis.call('INCR', KEYS[1])
if new == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return {1, new}
`;

let checkAndIncrSha;

export async function loadLuaScripts() {
  checkAndIncrSha = await redis.script('LOAD', CHECK_AND_INCR_LUA);
}

export async function checkAndIncrementQuota(key, limit, ttlSeconds) {
  const [allowed, count] = await redis.evalsha(
    checkAndIncrSha,
    1,
    key,
    String(limit),
    String(ttlSeconds),
  );
  return { allowed: allowed === 1, count };
}

export function secondsUntilNextMonth() {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 5));
  return Math.ceil((nextMonth.getTime() - now.getTime()) / 1000);
}

/** Read-only peek at a counter's current value — never increments. */
export async function peekQuotaCount(key) {
  const value = await redis.get(key);
  return value ? Number(value) : 0;
}

export function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
