import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { Badge } from '../ui/Badge';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useOrg } from '../org/OrgContext';
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_TONE,
  canManageAccounts,
  validateAccessToken,
  type ProviderInfo,
  type SocialAccount,
} from '../publishing/publishing';

export function SocialAccountsPage() {
  const { current } = useOrg();
  const orgId = current?.id ?? null;
  const accounts = useApi<SocialAccount[]>(orgId ? `/organizations/${orgId}/social-accounts` : null);
  const provider = useApi<ProviderInfo>(orgId ? `/organizations/${orgId}/social-accounts/provider` : null);
  const live = provider.data?.mode === 'live';
  const [handle, setHandle] = useState('');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!current || !orgId) {
    return null;
  }
  const manage = canManageAccounts(current.role);

  async function run(work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await work();
      await accounts.reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    const problem = live ? validateAccessToken(token) : null;
    setTokenError(problem);
    if (problem) {
      return;
    }
    const body = live
      ? { handle: handle.trim(), displayName: displayName.trim(), accessToken: token.trim() }
      : { handle: handle.trim(), displayName: displayName.trim() };
    const ok = await run(() => api(`/organizations/${orgId}/social-accounts`, { method: 'POST', body }));
    // Token chỉ nằm trong ô nhập cho đến khi gửi đi; xóa ngay dù thành công hay không.
    setToken('');
    if (ok) {
      setHandle('');
      setDisplayName('');
    }
  }

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Tài khoản Threads</h1>
          <p className="muted">Nơi bài đã duyệt sẽ được đăng lên.</p>
        </div>
      </header>

      {provider.data && !live && (
        <p className="notice notice-warn" role="status">
          Hệ thống đang ở chế độ giả lập: bài "đăng" sẽ không xuất hiện trên Threads thật. Muốn đăng thật, quản trị hệ thống đặt THREADS_PROVIDER=official.
        </p>
      )}
      {live && (
        <p className="notice notice-warn" role="status">
          Hệ thống đang ở chế độ Threads thật: bài đã duyệt sẽ được đăng lên tài khoản bạn kết nối. Hãy thử trên tài khoản của chính bạn trước.
        </p>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {manage && (
        <section className="card">
          <h2>{live ? 'Kết nối tài khoản Threads' : 'Thêm tài khoản giả lập'}</h2>
          <form className="form" onSubmit={(e) => void connect(e)}>
            <label>
              Tên tài khoản
              <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={61} placeholder="ten.tai.khoan" />
            </label>
            <label>
              Tên hiển thị
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
            </label>
            {live && (
              <label>
                Access token Threads
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Dán token dài hạn của tài khoản"
                />
              </label>
            )}
            {live && (
              <p className="muted small">
                Token được mã hóa khi lưu và không bao giờ hiển thị lại. Tên tài khoản phải khớp với token. Token hết hạn sau khoảng 60 ngày:
                khi đó nhập lại tại đây để kết nối lại.
              </p>
            )}
            {tokenError && <p className="field-error" role="alert">{tokenError}</p>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !provider.data || handle.trim() === '' || displayName.trim() === '' || (live && token.trim() === '')}
            >
              {busy ? 'Đang kết nối…' : live ? 'Kết nối tài khoản' : 'Thêm tài khoản'}
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Danh sách</h2>
        {accounts.error && !accounts.data && <p className="notice notice-error" role="alert">{accounts.error}</p>}
        {!accounts.data && !accounts.error && <p className="muted">Đang tải…</p>}
        {accounts.data && accounts.data.length === 0 && (
          <p className="muted">Chưa có tài khoản nào.{manage ? (live ? ' Kết nối tài khoản Threads ở trên để lên lịch đăng.' : ' Thêm một tài khoản giả lập ở trên để lên lịch thử.') : ' Nhờ chủ sở hữu hoặc quản trị viên thêm tài khoản.'}</p>
        )}
        <ul className="timeline">
          {(accounts.data ?? []).map((a) => (
            <li key={a.id}>
              <span className="row">
                <strong>@{a.handle}</strong> {a.displayName}
                <Badge tone={ACCOUNT_STATUS_TONE[a.status]}>{ACCOUNT_STATUS_LABEL[a.status]}</Badge>
                {a.mode === 'MOCK' && <Badge>Giả lập</Badge>}
                {a.mode === 'OFFICIAL' && <Badge>Threads thật</Badge>}
                {manage && live && a.status === 'NEEDS_REAUTH' && (
                  <span className="muted small">Token hết hạn hoặc bị thu hồi: nhập lại token ở trên để kết nối lại.</span>
                )}
                {manage && a.status === 'ACTIVE' && (
                  <ConfirmButton
                    label="Ngắt kết nối"
                    confirmLabel="Xác nhận ngắt"
                    disabled={busy}
                    onConfirm={() => void run(() => api(`/organizations/${orgId}/social-accounts/${a.id}/disconnect`, { method: 'POST' }))}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">Muốn ngắt kết nối, hãy hủy lịch các bài đang chờ đăng của tài khoản đó trước.</p>
      </section>
    </div>
  );
}
