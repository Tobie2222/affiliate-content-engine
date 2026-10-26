import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  applySession,
  clearSession,
  hasStoredSession,
  onSessionLost,
  refreshSession,
  type AuthResult,
  type AuthUser,
} from '../api/client';

type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(hasStoredSession() ? 'loading' : 'anon');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    onSessionLost(() => {
      setUser(null);
      setStatus('anon');
    });
    return () => onSessionLost(null);
  }, []);

  // Khôi phục phiên sau khi tải lại trang bằng refresh token đã lưu.
  useEffect(() => {
    if (!hasStoredSession()) {
      return;
    }
    let active = true;
    void refreshSession().then((result) => {
      if (!active) {
        return;
      }
      setUser(result?.user ?? null);
      setStatus(result ? 'authed' : 'anon');
    });
    return () => {
      active = false;
    };
  }, []);

  const finish = useCallback((result: AuthResult) => {
    applySession(result);
    setUser(result.user);
    setStatus('authed');
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      finish(await api<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }));
    },
    [finish],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      finish(await api<AuthResult>('/auth/register', { method: 'POST', body: { email, password, displayName } }));
    },
    [finish],
  );

  const logout = useCallback(async () => {
    const stored = localStorage.getItem('ace.refreshToken');
    clearSession();
    setUser(null);
    setStatus('anon');
    if (stored) {
      try {
        await api<void>('/auth/logout', { method: 'POST', body: { refreshToken: stored } });
      } catch {
        // Đã đăng xuất phía trình duyệt; thu hồi phía máy chủ thất bại cũng không chặn người dùng.
      }
    }
  }, []);

  const value = useMemo(() => ({ status, user, login, register, logout }), [status, user, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth phải nằm trong AuthProvider');
  }
  return ctx;
}
