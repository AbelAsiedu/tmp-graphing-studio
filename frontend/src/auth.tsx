import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, TMP_SIGNIN_URL, type User } from './api';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  error: string;
  /** True when the API could not be reached (guest mode still works fully offline). */
  offline: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  devLogin?: (role: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, error: '', offline: false, signIn: () => {}, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    let wasHandoff = false;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const handoff = url.pathname === '/auth/callback' ? url.searchParams.get('handoff') : null;
        if (url.pathname === '/auth/callback') {
          // remove the one-time token from the address bar and history straight away
          window.history.replaceState(null, '', '/');
        }
        wasHandoff = !!handoff;
        const u = handoff ? await api.exchange(handoff) : await api.me();
        if (alive) setUser(u);
      } catch (e) {
        if (!alive) return;
        // A failed session check just means "guest mode" — only a failed sign-in handoff is worth telling the user about.
        if (!wasHandoff || (e instanceof ApiError && e.status === 0)) setOffline(true);
        else setError(e instanceof Error ? e.message : 'Sign-in failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const signIn = useCallback(() => {
    if (!TMP_SIGNIN_URL) { setError('Sign-in is not configured yet (VITE_TMP_SIGNIN_URL).'); return; }
    window.location.assign(TMP_SIGNIN_URL);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  const devLogin = import.meta.env.DEV
    ? async (role: string) => {
        try { setUser(await api.devLogin(role, role === 'tutor' ? 'Demo Tutor' : 'Demo Student', ['demo-class'])); setError(''); }
        catch (e) { setError(e instanceof Error ? e.message : 'Dev login failed'); }
      }
    : undefined;

  const value = useMemo(() => ({ user, loading, error, offline, signIn, signOut, devLogin }), [user, loading, error, offline, signIn, signOut, devLogin]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
