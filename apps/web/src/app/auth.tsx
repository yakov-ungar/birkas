import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse, Permission } from '@tuition/shared';
import { AUTH_LOST, HttpError, get, post, setCsrf } from '../api/client';

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  /** Message shown on the login screen after a forced logout (e.g. idle timeout). */
  notice: string | null;
  refresh: () => Promise<MeResponse | null>;
  logout: () => Promise<void>;
  has: (p: Permission) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await get<MeResponse>('/api/auth/me');
      setCsrf(m.csrfToken);
      setMe(m);
      setNotice(null);
      return m;
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 401) throw e;
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onLost = (e: Event) => {
      const detail = (e as CustomEvent<{ code?: string; message?: string }>).detail;
      setMe(null);
      setCsrf('');
      if (detail?.code === 'idle_timeout') setNotice(detail.message ?? null);
    };
    window.addEventListener(AUTH_LOST, onLost);
    return () => window.removeEventListener(AUTH_LOST, onLost);
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await post('/api/auth/logout');
    } finally {
      setMe(null);
      setCsrf('');
    }
  }, []);

  const has = useCallback((p: Permission) => !!me?.user.permissions.includes(p), [me]);

  return <Ctx.Provider value={{ me, loading, notice, refresh, logout, has }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
