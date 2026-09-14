import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { useLanguage } from './LanguageContext.jsx';

const SiteContentContext = createContext(null);

export function SiteContentProvider({ children }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const { lang } = useLanguage();

  const refresh = useCallback(async () => {
    try {
      const data = await api.siteContent(lang);
      setContent(data);
    } catch {
      setContent({});
    } finally {
      setLoading(false);
    }
  }, [lang]);

  // Refetches whenever the language changes — the server decides what a
  // language resolves to, including falling back per section, so the
  // client never has to guess which translations exist.
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SiteContentContext.Provider value={{ content: content ?? {}, loading, refresh }}>
      {children}
    </SiteContentContext.Provider>
  );
}

/**
 * Returns the admin-editable content for one section, falling back to
 * `defaults` while it's still loading or if that section was never
 * customized — so pages always render something sensible.
 */
export function useSiteContent(section, defaults) {
  const { content, loading } = useContext(SiteContentContext);
  return { data: content[section] ?? defaults, loading };
}
