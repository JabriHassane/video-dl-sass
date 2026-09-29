import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSiteContent } from '../SiteContentContext.jsx';
import { useT } from '../LanguageContext.jsx';

const DEFAULTS = {
  eyebrow: 'Tarifs',
  title: 'Un plan simple, qui grandit avec vous',
  subtitle: 'Commencez gratuitement, passez à Premium quand les playlists et la HD deviennent indispensables.',
  free: { name: 'Gratuit', price: '0€', sub: 'Pour découvrir le service', ctaLabel: 'Commencer' },
  premium: {
    name: 'Premium',
    price: '9,99€',
    priceSuffix: '/mois',
    sub: 'Pour un usage intensif',
    ctaLabel: "Contacter l'administrateur",
    extraFeatures: ['Support prioritaire'],
  },
  enterprise: {
    name: 'Entreprise',
    price: 'Sur mesure',
    sub: 'Volumes élevés, API dédiée, SLA',
    ctaLabel: 'Nous contacter',
    features: ['Quotas personnalisés', 'Accès API prioritaire', 'Support dédié', 'Facturation entreprise'],
  },
  compareTitle: 'Comparatif détaillé',
};

function formatLimit(t, n) {
  return n === -1 ? t('price.unlimited') : t('price.perMonth', { n });
}

function formatPlaylist(t, n) {
  if (n === -1) return t('price.unlimited');
  if (n === 0) return t('price.unavailable');
  return t('price.maxVideos', { n });
}

function formatStreams(t, n) {
  return n > 1 ? t('price.streams', { n }) : t('price.stream', { n });
}

export default function Pricing() {
  const { data: copy } = useSiteContent('pricing', DEFAULTS);
  const [quotas, setQuotas] = useState(null);
  const [error, setError] = useState(null);
  const t = useT();

  useEffect(() => {
    api.pricing().then(setQuotas).catch((e) => setError(e.message));
  }, []);

  const free = quotas?.free;
  const premium = quotas?.premium;

  return (
    <div className="pricing-page">
      <section className="pricing-hero">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="pricing-cards">
        <div className="price-card">
          <h3>{copy.free.name}</h3>
          <div className="price-amount">{copy.free.price}</div>
          <p className="price-sub">{copy.free.sub}</p>
          <ul>
            <li>{free ? formatLimit(t, free.monthly_download_limit) : '…'}</li>
            <li>{t('price.upTo', { res: free?.max_resolution ?? '720p' })}</li>
            <li>{t('price.playlistsLabel')} {free ? formatPlaylist(t, free.max_playlist_items) : '…'}</li>
            <li>{formatStreams(t, free?.max_concurrent_streams ?? 1)}</li>
          </ul>
          <Link to="/register" className="btn-secondary full">{copy.free.ctaLabel}</Link>
        </div>

        <div className="price-card featured">
          <span className="badge-popular">{t('price.recommended')}</span>
          <h3>{copy.premium.name}</h3>
          <div className="price-amount">{copy.premium.price}<span>{copy.premium.priceSuffix}</span></div>
          <p className="price-sub">{copy.premium.sub}</p>
          <ul>
            <li>{premium ? formatLimit(t, premium.monthly_download_limit) : '…'}</li>
            <li>{t('price.upTo', { res: premium?.max_resolution ?? '4k' })}</li>
            <li>{t('price.playlistsLabel')} {premium ? formatPlaylist(t, premium.max_playlist_items) : '…'}</li>
            <li>{formatStreams(t, premium?.max_concurrent_streams ?? 2)}</li>
            {(copy.premium.extraFeatures ?? []).map((f) => <li key={f}>{f}</li>)}
          </ul>
          {/* No self-serve billing exists in this app — an admin upgrades
              the account by hand (role change or a quota override) after
              being contacted, so this deliberately goes to Contact rather
              than Register. */}
          <Link to="/contact" className="btn-primary full">{copy.premium.ctaLabel}</Link>
        </div>

        <div className="price-card">
          <h3>{copy.enterprise.name}</h3>
          <div className="price-amount">{copy.enterprise.price}</div>
          <p className="price-sub">{copy.enterprise.sub}</p>
          <ul>
            {(copy.enterprise.features ?? []).map((f) => <li key={f}>{f}</li>)}
          </ul>
          <Link to="/contact" className="btn-secondary full">{copy.enterprise.ctaLabel}</Link>
        </div>
      </section>

      <section className="section">
        <h2>{copy.compareTitle}</h2>
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th>{t('price.feature')}</th>
                <th>{copy.free.name}</th>
                <th>{copy.premium.name}</th>
                <th>{copy.enterprise.name}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('price.downloadsPerMonth')}</td>
                <td>{free ? formatLimit(t, free.monthly_download_limit) : '…'}</td>
                <td>{premium ? formatLimit(t, premium.monthly_download_limit) : '…'}</td>
                <td>{t('price.custom')}</td>
              </tr>
              <tr>
                <td>{t('price.maxResolution')}</td>
                <td>{free?.max_resolution ?? '720p'}</td>
                <td>{premium?.max_resolution ?? '4k'}</td>
                <td>4k</td>
              </tr>
              <tr>
                <td>{t('price.playlists')}</td>
                <td>{free ? formatPlaylist(t, free.max_playlist_items) : '…'}</td>
                <td>{premium ? formatPlaylist(t, premium.max_playlist_items) : '…'}</td>
                <td>{t('price.unlimited')}</td>
              </tr>
              <tr>
                <td>{t('price.concurrent')}</td>
                <td>{free?.max_concurrent_streams ?? 1}</td>
                <td>{premium?.max_concurrent_streams ?? 2}</td>
                <td>{t('price.custom')}</td>
              </tr>
              <tr>
                <td>{t('price.apiAccess')}</td>
                <td>✓</td>
                <td>✓</td>
                <td>{t('price.apiPriority')}</td>
              </tr>
              <tr>
                <td>{t('price.support')}</td>
                <td>{t('price.supportCommunity')}</td>
                <td>{t('price.supportPriority')}</td>
                <td>{t('price.supportDedicated')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
