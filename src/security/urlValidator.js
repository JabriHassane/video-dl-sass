import dns from 'node:dns/promises';
import net from 'node:net';
import { getAllowedDomains } from '../services/platformService.js';

export class SsrfBlockedError extends Error {
  constructor(reason) {
    super(`URL rejected: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

// RFC1918 / loopback / link-local / metadata / CGNAT / ULA ranges, as
// integer or prefix checks. Kept explicit and auditable rather than
// pulling in a "is-private-ip"-style dependency of unknown provenance.
function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // fail closed
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIpv6(ip) {
  const norm = ip.toLowerCase();
  if (norm === '::1') return true; // loopback
  if (norm.startsWith('fe80:')) return true; // link-local
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // ULA fc00::/7
  if (norm.startsWith('::ffff:')) {
    // IPv4-mapped address — validate the embedded v4 part too
    const v4 = norm.split(':').pop();
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
  }
  return false;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true; // unrecognized -> fail closed
}

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/\.$/, '');
}

async function isAllowedHost(hostname) {
  const host = normalizeHost(hostname);
  // Live, admin-managed allowlist (Redis-cached). Deny-by-default still
  // holds: an empty or unreachable list means nothing matches.
  const allowed = await getAllowedDomains();
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Validates a user-supplied source URL against SSRF vectors:
 *  1. scheme must be http(s)
 *  2. host must be on the domain allowlist (no IP literals allowed at all)
 *  3. every resolved A/AAAA record must be a public address
 *
 * Throws SsrfBlockedError on any violation. The caller must use the
 * validated `url` string as-is and must NOT re-resolve/re-validate a
 * different value later (TOCTOU note below).
 */
export async function assertSafeSourceUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('malformed URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SsrfBlockedError(`scheme ${parsed.protocol} not permitted`);
  }

  // Reject IP-literal hosts outright — legitimate video platforms are
  // always referenced by domain name, so this closes an entire bypass class.
  if (net.isIP(parsed.hostname)) {
    throw new SsrfBlockedError('IP-literal hosts are not permitted');
  }

  if (!(await isAllowedHost(parsed.hostname))) {
    throw new SsrfBlockedError(
      `host "${parsed.hostname}" is not a supported platform`,
    );
  }

  let records;
  try {
    records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError('DNS resolution failed');
  }

  if (records.length === 0) {
    throw new SsrfBlockedError('no DNS records found');
  }

  for (const { address } of records) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(`resolved address ${address} is private/reserved`);
    }
  }

  return parsed;
}

/**
 * Note on TOCTOU / DNS rebinding: the yt-dlp subprocess performs its own
 * DNS resolution when it actually connects, which happens after this check.
 * Mitigate by running the extractor with network egress restricted to the
 * platform's known IP ranges at the firewall/egress-proxy layer (see
 * README "Defense in depth") rather than relying on the app-layer check alone.
 */
