import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './AuthContext.jsx';
import { SiteContentProvider } from './SiteContentContext.jsx';
import { LanguageProvider } from './LanguageContext.jsx';
// Self-hosted (bundled by Vite, served from our own origin) rather than a
// CDN <link> — the API's CSP is 'self'-only for styles/fonts, and a
// third-party font host would need that policy relaxed for every visitor
// just to draw a handful of sidebar icons.
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Language is outermost: SiteContentProvider fetches the copy for
          the active language, so it must be able to read it. */}
      <LanguageProvider>
        <AuthProvider>
          <SiteContentProvider>
            <App />
          </SiteContentProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
