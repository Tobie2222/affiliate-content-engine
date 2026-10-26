import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { status, login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authed') {
    return <Navigate to="/office" replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thực hiện được. Hãy thử lại.');
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Affiliate Content Engine</h1>
        <p className="muted">Văn phòng AI chuẩn bị nội dung cho Threads. Bạn duyệt từng bài trước khi đăng.</p>

        <div className="tabs" role="tablist" aria-label="Chọn hình thức">
          <button type="button" role="tab" aria-selected={isLogin} onClick={() => { setMode('login'); setError(null); }}>
            Đăng nhập
          </button>
          <button type="button" role="tab" aria-selected={!isLogin} onClick={() => { setMode('register'); setError(null); }}>
            Tạo tài khoản
          </button>
        </div>

        <form onSubmit={(e) => void submit(e)} className="form">
          {!isLogin && (
            <label>
              Tên hiển thị
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={100} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isLogin ? 1 : 10}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
            {!isLogin && <small className="muted">Tối thiểu 10 ký tự.</small>}
          </label>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang xử lý…' : isLogin ? 'Đăng nhập' : 'Tạo tài khoản'}
          </button>
        </form>
      </div>
    </main>
  );
}
