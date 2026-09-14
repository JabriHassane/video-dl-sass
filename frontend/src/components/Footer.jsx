import { Link } from 'react-router-dom';
import { useSiteContent } from '../SiteContentContext.jsx';
import { useT } from '../LanguageContext.jsx';

const DEFAULTS = {
  tagline: 'Téléchargement de vidéos et playlists en streaming direct, sans stockage disque.',
  copyright: 'AZ Web Solutions. Tous droits réservés.',
};

export default function Footer() {
  const { data } = useSiteContent('footer', DEFAULTS);
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="brand">Video DL SaaS</span>
          <p>{data.tagline}</p>
        </div>

        <div className="footer-links">
          <div className="footer-col">
            <h4>{t('footer.product')}</h4>
            <Link to="/app">{t('nav.openApp')}</Link>
            <Link to="/pricing">{t('nav.pricing')}</Link>
            <a href={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8080'}/docs`} target="_blank" rel="noreferrer">
              {t('footer.apiDocs')}
            </a>
          </div>
          <div className="footer-col">
            <h4>{t('footer.company')}</h4>
            <Link to="/about">{t('nav.about')}</Link>
            <Link to="/faq">{t('nav.faq')}</Link>
            <Link to="/contact">{t('nav.contact')}</Link>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <span>© {year} {data.copyright}</span>
        {/* Required to be reachable from every page, not buried in a menu. */}
        <Link to="/cookies" className="footer-legal-link">{t('footer.cookiePolicy')}</Link>
      </div>
    </footer>
  );
}
