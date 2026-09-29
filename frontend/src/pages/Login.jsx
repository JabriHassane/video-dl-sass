import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { useT } from '../LanguageContext.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { authenticated, loading, refresh } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  // Reaching /login (URL typed, bookmarked, back button...) while a
  // session already exists must not show the form again — send the
  // visitor straight to the app instead.
  if (!loading && authenticated) return <Navigate to="/app" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.login(email, password);
      await refresh();
      navigate('/app');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card auth-card">
      <h1>{t('auth.login')}</h1>
      <form onSubmit={handleSubmit}>
        <label>
          {t('auth.email')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {t('auth.password')}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
      <p>{t('auth.noAccount')} <Link to="/register">{t('auth.createOne')}</Link></p>
    </div>
  );
}
