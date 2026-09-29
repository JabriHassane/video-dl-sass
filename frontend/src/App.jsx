import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import Footer from './components/Footer.jsx';
import Landing from './pages/Landing.jsx';
import Pricing from './pages/Pricing.jsx';
import About from './pages/About.jsx';
import Faq from './pages/Faq.jsx';
import Contact from './pages/Contact.jsx';
import Cookies from './pages/Cookies.jsx';
import CookieNotice from './components/CookieNotice.jsx';
import Download from './pages/Download.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Admin from './pages/Admin.jsx';
import Account from './pages/Account.jsx';
import { useAuth } from './AuthContext.jsx';

const MARKETING_PATHS = new Set(['/', '/pricing', '/about', '/faq', '/contact', '/cookies']);

function RequireAdmin({ children }) {
  const { loading, authenticated, user } = useAuth();
  if (loading) return <div className="card">Chargement...</div>;
  if (!authenticated || user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return children;
}

function RequireAuth({ children }) {
  const { loading, authenticated } = useAuth();
  if (loading) return <div className="card">Chargement...</div>;
  if (!authenticated) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const location = useLocation();
  const isMarketing = MARKETING_PATHS.has(location.pathname);
  const isAdmin = location.pathname.startsWith('/admin');

  return (
    <>
      <NavBar />
      <main className={isMarketing ? 'marketing-main' : isAdmin ? 'admin-main' : 'container'}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/cookies" element={<Cookies />} />
          <Route path="/app" element={<Download />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/account"
            element={
              <RequireAuth>
                <Account />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <Admin />
              </RequireAdmin>
            }
          />
        </Routes>
      </main>
      <Footer />
      <CookieNotice />
    </>
  );
}
