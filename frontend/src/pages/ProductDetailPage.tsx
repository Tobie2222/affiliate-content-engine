import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { useOrg } from '../org/OrgContext';
import {
  DATA_SOURCE_LABEL,
  FRESHNESS_LABEL,
  LINK_SOURCE_LABEL,
  LINK_STATUS_LABEL,
  canWriteCatalog,
  formatCommission,
  formatPrice,
  linkActions,
  priceFreshness,
  scoreTone,
  type ApiConnection,
  type ApiLink,
  type ApiProduct,
} from '../products/products';
import { Badge, type BadgeTone } from '../ui/Badge';
import { ConfirmButton } from '../ui/ConfirmButton';

const LINK_TONE: Record<ApiLink['linkStatus'], BadgeTone> = {
  UNVERIFIED: 'wait',
  ACTIVE: 'good',
  INVALID: 'bad',
  REVOKED: 'bad',
};

const FRESHNESS_TONE = { unknown: 'wait', fresh: 'good', stale: 'bad' } as const;

export function ProductDetailPage() {
  const { productId } = useParams();
  const { current } = useOrg();
  const orgId = current?.id ?? null;
  const product = useApi<ApiProduct>(orgId && productId ? `/organizations/${orgId}/products/${productId}` : null);
  const links = useApi<ApiLink[]>(orgId && productId ? `/organizations/${orgId}/products/${productId}/links` : null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!current || !orgId || !productId) {
    return null;
  }
  if (product.error && !product.data) {
    return (
      <div>
        <p><Link to="/products">← Về danh sách sản phẩm</Link></p>
        <p className="notice notice-error" role="alert">
          {product.status === 404 || product.status === 403 ? 'Không tìm thấy sản phẩm này trong tổ chức hiện tại.' : product.error}
        </p>
        <button type="button" className="btn" onClick={() => void product.reload()}>Thử lại</button>
      </div>
    );
  }
  if (!product.data) {
    return <p className="muted">Đang tải sản phẩm…</p>;
  }

  const p = product.data;
  const role = current.role;
  const writer = canWriteCatalog(role);
  const freshness = priceFreshness(p.currentPrice, p.priceVerifiedAt, new Date());
  const linkBase = `/organizations/${orgId}/affiliate-links`;

  async function act(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await work();
      setMessage(success);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Thao tác thất bại.');
    } finally {
      await links.reload();
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="back"><Link to="/products">← Về danh sách sản phẩm</Link></p>
      <header className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p className="muted">{p.category ?? 'Chưa có danh mục'} · Mã {p.externalProductId}</p>
        </div>
        <div className="row">
          <Badge tone={scoreTone(p.score.score)}>Điểm dữ liệu {p.score.score}/100</Badge>
          <Badge>{DATA_SOURCE_LABEL[p.dataSource]}</Badge>
        </div>
      </header>

      {message && <p className="notice notice-info" role="status">{message}</p>}
      {actionError && <p className="notice notice-error" role="alert">{actionError}</p>}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <h2>Thông tin</h2>
            <dl className="facts">
              <dt>Giá</dt>
              <dd>
                {formatPrice(p.currentPrice, p.currency)}{' '}
                <Badge tone={FRESHNESS_TONE[freshness]}>{FRESHNESS_LABEL[freshness]}</Badge>
              </dd>
              <dt>Hoa hồng</dt>
              <dd>{formatCommission(p.commissionRate)}</dd>
              <dt>Link sản phẩm</dt>
              <dd><a href={p.productUrl} target="_blank" rel="noreferrer noopener">{p.productUrl}</a></dd>
              {p.description && (<><dt>Mô tả</dt><dd className="wrap">{p.description}</dd></>)}
            </dl>
            <p className="muted small">
              Giá hoặc hoa hồng "chưa biết" nghĩa là nguồn dữ liệu không cung cấp, không phải bằng 0. Bài viết không được nêu giá khi giá chưa xác minh hoặc đã cũ.
            </p>
          </section>

          <section className="card">
            <h2>Điểm dữ liệu</h2>
            <p className="muted small">Cho biết sản phẩm đã đủ thông tin và hoa hồng ra sao. Đây không phải dự đoán doanh số.</p>
            <ul className="breakdown">
              {p.score.breakdown.map((f) => (
                <li key={f.factor}>
                  <span>{f.note}</span>
                  <strong>{f.points}/{f.max}</strong>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="detail-side">
          <section className="card">
            <h2>Link affiliate</h2>
            {links.error && <p className="notice notice-error" role="alert">{links.error}</p>}
            {links.data && links.data.length === 0 && <p className="muted">Chưa có link. Thêm link bên dưới để dùng sản phẩm này trong bài.</p>}
            <ul className="link-list">
              {(links.data ?? []).map((l) => {
                const actions = linkActions(l, role);
                return (
                  <li key={l.id}>
                    <p className="link-url">{l.affiliateUrl}</p>
                    <div className="row">
                      <Badge tone={LINK_TONE[l.linkStatus]}>{LINK_STATUS_LABEL[l.linkStatus]}</Badge>
                      <Badge>{LINK_SOURCE_LABEL[l.source]}</Badge>
                      {!l.publishable.ok && l.linkStatus === 'ACTIVE' && <Badge tone="bad">Không đăng được</Badge>}
                    </div>
                    {!l.publishable.ok && <p className="muted small">{l.publishable.reason}</p>}
                    {(actions.canVerify || actions.canRevoke) && (
                      <div className="row link-actions">
                        {actions.canVerify && (
                          <ConfirmButton
                            label="Xác minh"
                            confirmLabel="Tôi đã mở link và thấy đúng sản phẩm"
                            disabled={busy}
                            onConfirm={() => void act(() => api(`${linkBase}/${l.id}/verify`, { method: 'POST' }), 'Đã xác minh link.')}
                          />
                        )}
                        {actions.canRevoke && (
                          <ConfirmButton
                            label="Thu hồi"
                            confirmLabel="Thu hồi link này"
                            disabled={busy}
                            onConfirm={() => void act(() => api(`${linkBase}/${l.id}/revoke`, { method: 'POST' }), 'Đã thu hồi link.')}
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {writer && (
            <AddLinkCard
              orgId={orgId}
              productId={productId}
              busy={busy}
              onAct={act}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function AddLinkCard({
  orgId,
  productId,
  busy,
  onAct,
}: {
  orgId: string;
  productId: string;
  busy: boolean;
  onAct(work: () => Promise<unknown>, success: string): Promise<void>;
}) {
  const connections = useApi<ApiConnection[]>(`/organizations/${orgId}/affiliate-connections`);
  const [url, setUrl] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [subId, setSubId] = useState('');
  const list = connections.data ?? [];
  const selected = connectionId || list[0]?.id || '';
  const base = `/organizations/${orgId}/products/${productId}/links`;

  async function addUrl(e: FormEvent) {
    e.preventDefault();
    await onAct(() => api(base, { method: 'POST', body: { affiliateUrl: url.trim() } }), 'Đã thêm link. Link ở trạng thái chưa xác minh cho tới khi người có quyền xác minh.');
    setUrl('');
  }

  async function generate(e: FormEvent) {
    e.preventDefault();
    await onAct(
      () => api(`${base}/generate`, { method: 'POST', body: { connectionId: selected, ...(subId.trim() ? { subId: subId.trim() } : {}) } }),
      'Đã tạo link giả lập.',
    );
    setSubId('');
  }

  return (
    <section className="card">
      <h2>Thêm link</h2>
      <form className="form" onSubmit={(e) => void addUrl(e)}>
        <label>
          Link affiliate của bạn
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://s.shopee.vn/AbCdEf" maxLength={2048} />
          <small className="muted">Chỉ nhận link thuộc tên miền Shopee affiliate. Link mới nhập luôn ở trạng thái chưa xác minh.</small>
        </label>
        <button type="submit" className="btn" disabled={busy || url.trim() === ''}>Thêm link</button>
      </form>

      {list.length > 0 && (
        <form className="form form-sep" onSubmit={(e) => void generate(e)}>
          <h3>Hoặc tạo link giả lập</h3>
          <label>
            Kết nối
            <select value={selected} onChange={(e) => setConnectionId(e.target.value)}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>Shopee · {c.connectionStatus === 'MOCK' ? 'giả lập' : c.connectionStatus.toLowerCase()}</option>
              ))}
            </select>
          </label>
          <label>
            Mã theo dõi (không bắt buộc)
            <input value={subId} onChange={(e) => setSubId(e.target.value)} maxLength={50} />
          </label>
          <button type="submit" className="btn" disabled={busy || !selected}>Tạo link giả lập</button>
        </form>
      )}
      {connections.data && list.length === 0 && (
        <p className="muted small">Muốn tạo link giả lập, hãy tạo kết nối ở "Đồng bộ Shopee (giả lập)" trên trang danh sách.</p>
      )}
    </section>
  );
}
