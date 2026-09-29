import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useT } from '../LanguageContext.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { api } from '../api.js';

export default function NavBar() {
  const { authenticated, user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigating with the mobile menu open would leave it covering the page
  // the visitor just asked for.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    await api.logout();
    await refresh();
    navigate('/');
  }

  const navClass = ({ isActive }) => (isActive ? 'active' : '');

  return (
    <nav className="navbar">
      <Link to="/" className="brand">Video DL SaaS</Link>

      <button
        type="button"
        className={`nav-burger ${menuOpen ? 'open' : ''}`}
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-label="Menu"
      >
        <span /><span /><span />
      </button>

      <div className={`nav-collapse ${menuOpen ? 'open' : ''}`}>
        <div className="nav-center">
          <NavLink to="/pricing" className={navClass}>{t('nav.pricing')}</NavLink>
          <NavLink to="/about" className={navClass}>{t('nav.about')}</NavLink>
          <NavLink to="/faq" className={navClass}>{t('nav.faq')}</NavLink>
          <NavLink to="/contact" className={navClass}>{t('nav.contact')}</NavLink>
        </div>

        <div className="nav-links">
          <LanguageSwitcher />
          <Link to="/app" className="nav-cta">{t('nav.openApp')}</Link>
          {authenticated && user?.role === 'ADMIN' && <Link to="/admin">{t('nav.admin')}</Link>}
          {authenticated ? (
            <>
              <Link to="/account" className="role-badge">{user.email} · {user.role}</Link>
              <button onClick={handleLogout}>{t('nav.logout')}</button>
            </>
          ) : (
            <>
              <Link to="/login">{t('nav.login')}</Link>
              <Link to="/register">{t('nav.register')}</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
