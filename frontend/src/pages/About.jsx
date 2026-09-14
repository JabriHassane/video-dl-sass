import { useSiteContent } from '../SiteContentContext.jsx';
import { sanitizeHtml } from '../sanitize.js';

const DEFAULTS = {
  eyebrow: 'À propos',
  title: 'Une architecture pensée pour la confidentialité',
  intro:
    "Video DL SaaS est développé par <strong>AZ Web Solutions</strong>. Notre conviction : un service qui manipule du contenu vidéo pour des tiers ne devrait jamais avoir besoin de le stocker pour fonctionner.",
  sections: [],
  beliefsTitle: 'Ce que nous croyons',
  beliefs: [],
};

export default function About() {
  const { data } = useSiteContent('about', DEFAULTS);

  return (
    <div className="content-page">
      <section className="pricing-hero">
        <span className="eyebrow">{data.eyebrow}</span>
        <h1>{data.title}</h1>
        <p dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.intro) }} />
      </section>

      <section className="section">
        <div className="two-col">
          {(data.sections ?? []).map((s) => (
            <div key={s.title}>
              <h2>{s.title}</h2>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{data.beliefsTitle}</h2>
        <div className="bento-grid three-col">
          {(data.beliefs ?? []).map((b) => (
            <div key={b.title} className="bento-card">
              <h3>{b.title}</h3>
              <p>{b.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
