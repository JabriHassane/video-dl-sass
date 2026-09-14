import { Link } from 'react-router-dom';
import { useSiteContent } from '../SiteContentContext.jsx';
import { useT } from '../LanguageContext.jsx';

// Mirrors the seeded `cookies` section. Kept minimal on purpose: if the
// section is missing the page still renders a truthful shell rather than
// crashing or, worse, displaying an empty cookie policy that implies we
// set none.
const DEFAULTS = {
  eyebrow: 'Confidentialité',
  title: 'Politique de cookies',
  intro: '',
  categories: [],
};

export default function Cookies() {
  const { data } = useSiteContent('cookies', DEFAULTS);
  const t = useT();
  const categories = data.categories ?? [];

  return (
    <div className="content-page">
      <section className="pricing-hero">
        <span className="eyebrow">{data.eyebrow}</span>
        <h1>{data.title}</h1>
        {data.updatedAt && (
          <p className="hint">{t('cookies.updatedAt')} {data.updatedAt}</p>
        )}
      </section>

      <section className="section cookie-policy">
        {data.intro && <p className="cookie-intro">{data.intro}</p>}

        {categories.map((cat) => (
          <div key={cat.name} className="cookie-category">
            <div className="cookie-category-head">
              <h2>{cat.name}</h2>
              {cat.status && <span className="cookie-badge">{cat.status}</span>}
            </div>
            {cat.description && <p>{cat.description}</p>}

            {/* Wrapped so a narrow screen scrolls the table, not the page. */}
            <div className="cookie-table-wrap">
              <table className="cookie-table">
                <thead>
                  <tr>
                    <th>{t('cookies.colName')}</th>
                    <th>{t('cookies.colPurpose')}</th>
                    <th>{t('cookies.colDuration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(cat.cookies ?? []).map((c) => (
                    <tr key={c.name}>
                      <td><code>{c.name}</code></td>
                      <td>
                        {c.purpose}
                        {c.note && <span className="cookie-note">{c.note}</span>}
                      </td>
                      <td className="cookie-duration">{c.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {data.consentNote && (
          <div className="cookie-callout">
            <p>{data.consentNote}</p>
          </div>
        )}

        {data.storage?.title && (
          <div className="cookie-block">
            <h2>{data.storage.title}</h2>
            <p>{data.storage.body}</p>
          </div>
        )}

        {data.serverSide?.title && (
          <div className="cookie-block">
            <h2>{data.serverSide.title}</h2>
            <p>{data.serverSide.body}</p>
          </div>
        )}

        {data.rights?.title && (
          <div className="cookie-block">
            <h2>{data.rights.title}</h2>
            <p>{data.rights.body}</p>
            {data.rights.ctaLabel && (
              <Link to="/contact" className="primary cookie-cta">
                {data.rights.ctaLabel}
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
