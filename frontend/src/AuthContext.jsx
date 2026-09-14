import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, hasSessionHint } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, authenticated: false, user: null, quota: null });

  const refresh = useCallback(async () => {
    try {
      let data = await api.me();

      // /api/auth/me answers for guests too, so an expired access token
      // looks exactly like "not signed in" — it returns 200 with
      // authenticated:false and never triggers the 401 retry. Without
      // this, every page reload after 15 minutes would silently log the
      // user out while their refresh token was still perfectly valid.
      if (!data.authenticated && hasSessionHint()) {
        await api.refresh().catch(() => null);
        data = await api.me();
      }

      setState({ loading: false, ...data });
    } catch {
      setState({ loading: false, authenticated: false, user: null, quota: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ ...state, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
