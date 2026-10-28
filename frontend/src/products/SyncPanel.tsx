import { useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { summarizeBulk, type ApiConnection, type BulkResult } from './products';

export function SyncPanel({
  orgId,
  onSynced,
  onCancel,
}: {
  orgId: string;
  onSynced(message: string): void;
  onCancel(): void;
}) {
  const connections = useApi<ApiConnection[]>(`/organizations/${orgId}/affiliate-connections`);
  const [connectionId, setConnectionId] = useState('');
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = connections.data ?? [];
  const selected = connectionId || list[0]?.id || '';

  async function createConnection() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<ApiConnection>(`/organizations/${orgId}/affiliate-connections`, {
        method: 'POST',
        body: { provider: 'SHOPEE' },
      });
      await connections.reload();
      setConnectionId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tạo được kết nối.');
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<BulkResult>(`/organizations/${orgId}/products/sync`, {
        method: 'POST',
        body: { connectionId: selected, limit },
      });
      onSynced(`Đồng bộ (dữ liệu giả lập): ${summarizeBulk(result)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đồng bộ được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card composer" aria-label="Đồng bộ từ Shopee">
      <h2>Đồng bộ từ Shopee (giả lập)</h2>
      <p className="notice notice-warn">
        Kết nối Shopee chính thức chưa được triển khai. Mục này tạo sản phẩm mẫu để bạn thử luồng; sản phẩm và link từ đây được đánh dấu "giả lập" và không đăng được trên môi trường production.
      </p>
      {connections.error && <p className="notice notice-error" role="alert">{connections.error}</p>}
      {connections.data && list.length === 0 && (
        <div>
          <p className="muted">Chưa có kết nối nào.</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void createConnection()}>Tạo kết nối giả lập</button>
        </div>
      )}
      {list.length > 0 && (
        <div className="form">
          <div className="grid-2">
            <label>
              Kết nối
              <select value={selected} onChange={(e) => setConnectionId(e.target.value)}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>Shopee · {c.connectionStatus === 'MOCK' ? 'giả lập' : c.connectionStatus.toLowerCase()}</option>
                ))}
              </select>
            </label>
            <label>
              Số sản phẩm
              <input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
            </label>
          </div>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || !selected} onClick={() => void sync()}>
              {busy ? 'Đang đồng bộ…' : 'Đồng bộ'}
            </button>
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>Đóng</button>
          </div>
        </div>
      )}
      {list.length === 0 && error && <p className="notice notice-error" role="alert">{error}</p>}
      {list.length === 0 && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Đóng</button>}
    </section>
  );
}
