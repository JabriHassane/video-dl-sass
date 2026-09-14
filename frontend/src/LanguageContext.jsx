import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANG, LANGUAGES, isSupported, translate } from './i18n.js';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'lang';

/**
 * Resolution order: an explicit past choice wins over the browser's
 * preference, which wins over the default. Reading the browser preference
 * only when nothing was chosen means a visitor who switched to French on
 * an English machine is not flipped back on their next visit.
 */
function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isSupported(saved)) return saved;
  } catch {
    // Storage blocked — fall through to the browser preference.
  }

  const fromBrowser = (navigator.language ?? '').slice(0, 2).toLowerCase();
  return isSupported(fromBrowser) ? fromBrowser : DEFAULT_LANG;
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  // Keeps the document in sync for screen readers, browser translation
  // prompts and CSS :lang() rules — a page that says lang="fr" while
  // displaying English is actively misleading to assistive tech.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (!isSupported(next)) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is survivable; the switch still applies this visit.
    }
    setLangState(next);
  }, []);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      languages: LANGUAGES,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

/** Shorthand for the common case of only needing the translate function. */
export function useT() {
  return useLanguage().t;
}
