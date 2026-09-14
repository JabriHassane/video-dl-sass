import { useState } from 'react';
import { api } from '../api.js';
import { useSiteContent } from '../SiteContentContext.jsx';

const DEFAULTS = {
  eyebrow: 'Contact',
  title: 'Une question, un projet Entreprise ?',
  subtitle: 'Écrivez-nous — nous répondons généralement sous 1 jour ouvré.',
  successTitle: 'Message envoyé',
  successText: 'Merci, nous revenons vers vous rapidement.',
};

export default function Contact() {
  const { data } = useSiteContent('contact', DEFAULTS);
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState(null);

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      await api.sendContactMessage(form);
      setStatus('sent');
      setForm({ name: '', email: '', subject: '', message: '' });
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <div className="content-page">
      <section className="pricing-hero">
        <span className="eyebrow">{data.eyebrow}</span>
        <h1>{data.title}</h1>
        <p>{data.subtitle}</p>
      </section>

      <section className="section contact-section">
        {status === 'sent' ? (
          <div className="card contact-success">
            <h2>{data.successTitle}</h2>
            <p>{data.successText}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card contact-form">
            <label>
              Nom
              <input value={form.name} onChange={(e) => setField('name', e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} required />
            </label>
            <label>
              Sujet
              <input value={form.subject} onChange={(e) => setField('subject', e.target.value)} />
            </label>
            <label>
              Message
              <textarea
                rows={5}
                value={form.message}
                onChange={(e) => setField('message', e.target.value)}
                required
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary" disabled={status === 'sending'}>
              {status === 'sending' ? 'Envoi...' : 'Envoyer'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
