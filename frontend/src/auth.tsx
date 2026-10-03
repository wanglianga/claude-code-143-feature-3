import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { get, post, getToken, setToken } from './api';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  phone: string;
  role: 'WORKER' | 'ENTERPRISE' | 'SUPERVISOR' | 'SUPPORT';
  enterpriseId: number | null;
  idCardNo?: string | null;
  idVerified: boolean;
  healthCertUntil: string | null;
  hasFaceSample: boolean;
  walletBalance?: number;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (dto: any) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!getToken()) { setUser(null); return; }
    try {
      const me = await get('/auth/me');
      setUser(me.user);
    } catch {
      setToken(null);
      setUser(null);
    }
  };

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    const r = await post('/auth/login', { username, password });
    setToken(r.token);
    setUser(r.user);
  };

  const register = async (dto: any) => {
    const r = await post('/auth/register', dto);
    setToken(r.token);
    setUser(r.user);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
