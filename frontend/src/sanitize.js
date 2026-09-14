import DOMPurify from 'dompurify';

/**
 * The only place in the app that renders admin-authored HTML (About page
 * "intro" field supports a <strong> tag). Sanitized even though only
 * ADMIN can write it: a hijacked admin session or a compromised account
 * shouldn't be able to turn this field into stored XSS against every
 * visitor of the public site.
 */
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: ['strong', 'em', 'b', 'i', 'br', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}
