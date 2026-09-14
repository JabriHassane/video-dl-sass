import { Link } from 'react-router-dom';
import { useSiteContent } from '../SiteContentContext.jsx';
import { useT } from '../LanguageContext.jsx';

const DEFAULTS = {
  eyebrow: 'Architecture Zero-Disk',
  title: 'Téléchargez vidéos et playlists sans jamais toucher notre disque',
  subtitle:
    "Un SaaS de téléchargement qui streame directement la source vers vous : rien n'est stocké, rien ne traîne. Sécurisé par design, contrôlé par rôle.",
  ctaPrimaryLabel: 'Commencer gratuitement',
  ctaSecondaryLabel: 'Essayer sans compte',
  hint: '1 vidéo gratuite sans inscription · aucune carte bancaire requise',
  stepsTitle: 'Comment ça marche',
  steps: [],
  ctaBandTitle: 'Prêt à essayer ?',
  ctaBandText: 'Créez un compte gratuit — aucune carte bancaire requise.',
  ctaBandButtonLabel: 'Créer mon compte',
};

export default function Landing() {
  const { data } = useSiteContent('landing', DEFAULTS);
  const t = useT();

  return (
    <div className="landing">
      <section className="hero">
        <span className="eyebrow">{data.eyebrow}</span>
        <h1>{data.title}</h1>
        <p className="hero-sub">{data.subtitle}</p>
        <div className="hero-cta">
          <Link to="/register" className="btn-primary">{data.ctaPrimaryLabel}</Link>
          <Link to="/app" className="btn-secondary">{data.ctaSecondaryLabel}</Link>
        </div>
        <p className="hint">{data.hint}</p>
      </section>

      <section className="demo-mock">
        <div className="demo-window">
          <div className="demo-titlebar">
            <span className="dot red" /><span className="dot yellow" /><span className="dot green" />
          </div>
          <div className="demo-body">
            <div className="demo-input">https://www.youtube.com/watch?v=…</div>
            <div className="demo-row">
              <span className="demo-pill">480p</span>
              <span className="demo-pill">720p</span>
              <span className="demo-pill active">1080p</span>
              <span className="demo-pill">4k</span>
            </div>
            <div className="demo-progress">
              <div className="demo-progress-fill" />
            </div>
            <span className="demo-status">{t('landing.demoStatus')}</span>
          </div>
        </div>
      </section>

      <section className="section steps-section">
        <h2>{data.stepsTitle}</h2>
        <div className="steps-grid">
          {(data.steps ?? []).map((s, i) => (
            <div key={s.title} className="step-card">
              <span className="step-number">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <h2>{data.ctaBandTitle}</h2>
        <p>{data.ctaBandText}</p>
        <Link to="/register" className="btn-primary">{data.ctaBandButtonLabel}</Link>
      </section>
    </div>
  );
}
