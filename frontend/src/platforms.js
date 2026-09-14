/**
 * Per-platform accent colors used for badges, the detected-source chip and
 * the input's focus glow.
 *
 * Deliberately colors + initials only — no brand logos are bundled or
 * reproduced. It keeps the payload tiny (no icon sprite, no SVG set) and
 * avoids shipping third-party trademarked artwork.
 */
const PLATFORMS = {
  youtube: { label: 'YouTube', color: '#ff0033', initials: 'YT' },
  instagram: { label: 'Instagram', color: '#e1306c', initials: 'IG' },
  facebook: { label: 'Facebook', color: '#1877f2', initials: 'FB' },
  tiktok: { label: 'TikTok', color: '#25f4ee', initials: 'TT' },
  twitter: { label: 'X / Twitter', color: '#8899a6', initials: 'X' },
  vimeo: { label: 'Vimeo', color: '#1ab7ea', initials: 'VM' },
  dailymotion: { label: 'Dailymotion', color: '#0066dc', initials: 'DM' },
  reddit: { label: 'Reddit', color: '#ff4500', initials: 'RD' },
  twitch: { label: 'Twitch', color: '#9146ff', initials: 'TW' },
  soundcloud: { label: 'SoundCloud', color: '#ff5500', initials: 'SC' },
};

const FALLBACK = { label: 'Source', color: '#8b5cf6', initials: '••' };

export function platformStyle(slug) {
  return PLATFORMS[slug] ?? FALLBACK;
}

/**
 * Best-effort slug from a pasted URL, used only to tint the UI while the
 * user is still typing. The server remains the authority on whether a host
 * is actually allowed — this never gates anything.
 */
export function detectPlatformSlug(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  if (/(^|\.)(instagram\.com|instagr\.am)$/.test(host)) return 'instagram';
  if (/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/.test(host)) return 'facebook';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)(twitter\.com|x\.com)$/.test(host)) return 'twitter';
  if (/(^|\.)vimeo\.com$/.test(host)) return 'vimeo';
  if (/(^|\.)(dailymotion\.com|dai\.ly)$/.test(host)) return 'dailymotion';
  if (/(^|\.)(reddit\.com|redd\.it)$/.test(host)) return 'reddit';
  if (/(^|\.)twitch\.tv$/.test(host)) return 'twitch';
  if (/(^|\.)(soundcloud\.com|snd\.sc)$/.test(host)) return 'soundcloud';
  return null;
}

/** yt-dlp's extractor_key ("Youtube", "Instagram"...) -> our slug. */
export function slugFromExtractor(extractor) {
  if (!extractor) return null;
  const key = String(extractor).toLowerCase();
  return Object.keys(PLATFORMS).find((slug) => key.startsWith(slug)) ?? null;
}
