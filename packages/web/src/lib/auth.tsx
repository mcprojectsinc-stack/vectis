import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

interface User { id: string; email: string; role: string }
interface Tenant { id: string; name: string; enrollToken: string }

interface AuthCtx {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, orgName?: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api('/auth/me');
        setUser(me.user);
        setTenant(me.tenant);
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(r.token);
    const me = await api('/auth/me');
    setUser(me.user);
    setTenant(me.tenant);
  }

  async function signup(email: string, password: string, orgName?: string) {
    const r = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, orgName }) });
    setToken(r.token);
    setUser(r.user);
    setTenant(r.tenant);
  }

  function logout() {
    setToken(null);
    setUser(null);
    setTenant(null);
  }

  return <Ctx.Provider value={{ user, tenant, loading, login, signup, logout }}>{children}</Ctx.Provider>;
}
