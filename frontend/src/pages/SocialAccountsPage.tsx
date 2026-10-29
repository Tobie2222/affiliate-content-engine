import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { Badge } from '../ui/Badge';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useOrg } from '../org/OrgContext';
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, canManageAccounts, type SocialAccount } from '../publishing/publishing';

export function SocialAccountsPage() {
  const { current } = useOrg();
  const orgId = current?.id ?? null;
  const accounts = useApi<SocialAccount[]>(orgId ? `/organizations/${orgId}/social-accounts` : null);
  const [handle, setHandle] = useState('');
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
    const ok = await run(() => api(`/organizations/${orgId}/social-accounts`, { method: 'POST', body: { handle: handle.trim(), displayName: displayName.trim() } }));
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

      <p className="notice notice-warn" role="status">
        Hiện chỉ có tài khoản giả lập để chạy thử: bài "đăng" sẽ không xuất hiện trên Threads thật. Kết nối Threads thật chưa được hỗ trợ.
      </p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {manage && (
        <section className="card">
          <h2>Thêm tài khoản giả lập</h2>
          <form className="form" onSubmit={(e) => void connect(e)}>
            <label>
              Tên tài khoản
              <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={61} placeholder="ten.tai.khoan" />
            </label>
            <label>
              Tên hiển thị
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy || handle.trim() === '' || displayName.trim() === ''}>
              {busy ? 'Đang thêm…' : 'Thêm tài khoản'}
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Danh sách</h2>
        {accounts.error && !accounts.data && <p className="notice notice-error" role="alert">{accounts.error}</p>}
        {!accounts.data && !accounts.error && <p className="muted">Đang tải…</p>}
        {accounts.data && accounts.data.length === 0 && (
          <p className="muted">Chưa có tài khoản nào.{manage ? ' Thêm một tài khoản giả lập ở trên để lên lịch thử.' : ' Nhờ chủ sở hữu hoặc quản trị viên thêm tài khoản.'}</p>
        )}
        <ul className="timeline">
          {(accounts.data ?? []).map((a) => (
            <li key={a.id}>
              <span className="row">
                <strong>@{a.handle}</strong> {a.displayName}
                <Badge tone={ACCOUNT_STATUS_TONE[a.status]}>{ACCOUNT_STATUS_LABEL[a.status]}</Badge>
                {a.mode === 'MOCK' && <Badge>Giả lập</Badge>}
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
