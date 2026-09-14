import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSiteContent } from '../SiteContentContext.jsx';

const STORAGE_KEY = 'cookie-notice-dismissed';

const DEFAULTS = {
  noticeText:
    "Nous utilisons uniquement des cookies essentiels au fonctionnement du service. Aucun traceur publicitaire.",
  noticeDismiss: "J'ai compris",
  noticeMore: 'Politique de cookies',
};

/**
 * An information notice, deliberately NOT a consent gate.
 *
 * Every cookie this app sets is strictly necessary (authentication and the
 * free-tier counter), and those are exempt from consent under the ePrivacy
 * directive — see the comment on the seeded `cookies` section in
 * sql/schema.sql. Showing an accept/reject dialog would be misleading:
 * "reject" could not actually switch anything off. What the rules do
 * require is clear information, which is what this gives, with the full
 * detail one click away.
 *
 * The day a non-exempt cookie is added (analytics, ads, an embedded
 * third-party player), this must become a real consent mechanism: no such
 * cookie may be set before an explicit opt-in, and refusing must be as
 * easy as accepting.
 */
export default function CookieNotice() {
  const { data } = useSiteContent('cookies', DEFAULTS);
  const location = useLocation();
  // Starts hidden: showing the banner then hiding it once localStorage is
  // read would flash it on every page load for people who dismissed it.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // Private mode or storage blocked. Showing the notice every time is
      // the correct failure mode — informing twice beats informing never.
      setVisible(true);
    }
  }, []);

  function dismiss() {
    // Deliberately localStorage and not a cookie: remembering that you
    // closed a notice about cookies does not itself need to set one.
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Nothing to do — the notice simply reappears next visit.
    }
    setVisible(false);
  }

  // Pointless on the policy page itself — the visitor is already reading
  // the full version, and the floating box sits on top of the cookie
  // table it is pointing them to. Not dismissed, just not shown here.
  if (!visible || location.pathname === '/cookies') return null;

  return (
    <div className="cookie-notice" role="region" aria-label="Information sur les cookies">
      <p className="cookie-notice-text">{data.noticeText ?? DEFAULTS.noticeText}</p>
      <div className="cookie-notice-actions">
        <Link to="/cookies" className="cookie-notice-link">
          {data.noticeMore ?? DEFAULTS.noticeMore}
        </Link>
        <button type="button" className="primary cookie-notice-btn" onClick={dismiss}>
          {data.noticeDismiss ?? DEFAULTS.noticeDismiss}
        </button>
      </div>
    </div>
  );
}
